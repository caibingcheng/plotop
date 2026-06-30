#include <atomic>
#include <chrono>
#include <cstdint>
#include <list>
#include <mutex>
#include <sstream>
#include <thread>

#include "cmdline.h"
#include "internval.h"
#include "network.h"
#include "packet.h"

struct Arguments {
  std::string address;
  int32_t port;
  int32_t level;
  int32_t duration;
};

struct FilterConfig {
  mutable std::mutex mutex;
  std::list<int32_t> pids;

  void set(const std::list<int32_t> &new_pids) {
    std::lock_guard<std::mutex> lock(mutex);
    pids = new_pids;
  }

  std::list<int32_t> get() const {
    std::lock_guard<std::mutex> lock(mutex);
    return pids;
  }
};

static std::string extract_json_string_(const std::string &json, const std::string &key) {
  const std::string pattern = "\"" + key + "\"";
  const auto pos = json.find(pattern);
  if (pos == std::string::npos) {
    return "";
  }
  const auto value_start = json.find(':', pos + pattern.size());
  if (value_start == std::string::npos) {
    return "";
  }
  const auto quote_start = json.find('"', value_start + 1);
  if (quote_start == std::string::npos) {
    return "";
  }
  const auto quote_end = json.find('"', quote_start + 1);
  if (quote_end == std::string::npos) {
    return "";
  }
  return json.substr(quote_start + 1, quote_end - quote_start - 1);
}

static std::list<int32_t> extract_json_int_array_(const std::string &json, const std::string &key) {
  std::list<int32_t> values;
  const std::string pattern = "\"" + key + "\"";
  const auto pos = json.find(pattern);
  if (pos == std::string::npos) {
    return values;
  }
  const auto bracket_start = json.find('[', pos + pattern.size());
  if (bracket_start == std::string::npos) {
    return values;
  }
  const auto bracket_end = json.find(']', bracket_start + 1);
  if (bracket_end == std::string::npos) {
    return values;
  }

  std::string content = json.substr(bracket_start + 1, bracket_end - bracket_start - 1);
  std::istringstream iss(content);
  std::string token;
  while (std::getline(iss, token, ',')) {
    try {
      size_t start = token.find_first_of("0123456789-");
      if (start == std::string::npos) {
        continue;
      }
      values.push_back(static_cast<int32_t>(std::stoi(token.substr(start))));
    } catch (const std::exception &) {
    }
  }
  return values;
}

static void send_process_list_(Network *network, Packet *packet) {
  const auto processes = packet->get_process_list();
  std::list<std::pair<int32_t, std::string>> process_pairs;
  for (const auto &process : processes) {
    process_pairs.emplace_back(process.pid, process.name);
  }
  network->send(packet->to_process_list(process_pairs));
  packet->process_list_changed();
}

static void receiver_thread_(Network *network, Packet *packet, FilterConfig *filter_config,
                             std::atomic<bool> *stop_flag,
                             std::atomic<uint64_t> *last_server_seen_ms) {
  while (!stop_flag->load()) {
    try {
      const std::string message = network->recv();
      const std::string type = extract_json_string_(message, "type");
      const auto now_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                              std::chrono::steady_clock::now().time_since_epoch())
                              .count();
      last_server_seen_ms->store(static_cast<uint64_t>(now_ms));

      if (type == "filter") {
        const auto pids = extract_json_int_array_(message, "pids");
        filter_config->set(pids);

        std::ostringstream pid_stream;
        pid_stream << "[";
        for (auto it = pids.begin(); it != pids.end(); ++it) {
          if (it != pids.begin()) {
            pid_stream << ", ";
          }
          pid_stream << *it;
        }
        pid_stream << "]";
        Log::info("Received filter, pids: ", pid_stream.str());

        const auto current_processes = packet->get_process_list();
        int32_t matched_count = 0;
        for (const auto &process : current_processes) {
          for (const auto pid : pids) {
            if (process.pid == pid) {
              ++matched_count;
              break;
            }
          }
        }
        network->send(packet->to_filter_ack(matched_count));
      } else if (type == "heartbeat") {
        Log::debug("Received server heartbeat");
      } else if (type == "request_process_list") {
        Log::info("Received request_process_list, sending current process list");
        send_process_list_(network, packet);
      } else if (type.empty()) {
        Log::warning("Received message without type");
      } else {
        Log::warning("Received unknown message type: ", type);
      }
    } catch (const std::exception &e) {
      Log::error("Receiver thread error: ", e.what());
      stop_flag->store(true);
      break;
    }
  }
}

static void heartbeat_thread_(Network *network, Packet *packet, std::atomic<bool> *stop_flag,
                              const std::atomic<uint64_t> *last_server_seen_ms) {
  while (!stop_flag->load()) {
    try {
      const auto now_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                              std::chrono::steady_clock::now().time_since_epoch())
                              .count();
      const auto last_seen = last_server_seen_ms->load();
      if (last_seen > 0 && static_cast<uint64_t>(now_ms) > last_seen + 90000) {
        Log::error("Server heartbeat timeout");
        stop_flag->store(true);
        break;
      }
      network->send(packet->to_heartbeat());
    } catch (const std::exception &e) {
      Log::error("Heartbeat thread error: ", e.what());
      stop_flag->store(true);
      break;
    }

    for (int32_t i = 0; i < 300 && !stop_flag->load(); ++i) {
      std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
  }
}

int32_t main(int32_t argc, char **argv) {
  Arguments args;
  Cmdline cmdline;
  cmdline.add_argument('i', "ip", args.address, "127.0.0.1", "Server IP address");
  cmdline.add_argument('p', "port", args.port, 28081, "Server TCP port");
  cmdline.add_argument('l', "level", args.level, 2, "Log level: 0=ERROR, 1=INFO, 2=DEBUG");
  cmdline.add_argument('d', "duration", args.duration, 3, "Sampling interval in seconds");

  if (!cmdline.parse(argc, argv)) {
    return 0;
  }
  Log::set_level(static_cast<Log::Level>(args.level));

  static uint64_t retry_count = 0;
  uint64_t retry_ms = 100;

  do {
    std::unique_ptr<Packet> packet(new Packet());
    std::unique_ptr<Network> network(new Network(args.address, args.port));
    if (network->ready()) {
      retry_ms = 100;

      FilterConfig filter_config;
      std::atomic<bool> stop_flag(false);
      std::atomic<uint64_t> last_server_seen_ms(0);

      try {
        if (packet->process_list_changed()) {
          send_process_list_(network.get(), packet.get());
        }

        std::thread receiver(receiver_thread_, network.get(), packet.get(), &filter_config, &stop_flag,
                             &last_server_seen_ms);
        std::thread heartbeat(heartbeat_thread_, network.get(), packet.get(), &stop_flag, &last_server_seen_ms);

        Interval interval(args.duration, [&]() {
          if (stop_flag.load()) {
            throw std::runtime_error("Stopped");
          }

          Stats stats;
          const auto pids = filter_config.get();
          packet->collate(stats, pids);
          network->send(packet->to_json(stats));
        });

        interval.wait();
        stop_flag.store(true);

        if (receiver.joinable()) {
          receiver.join();
        }
        if (heartbeat.joinable()) {
          heartbeat.join();
        }
      } catch (const std::exception &e) {
        Log::error("Connection error: ", e.what());
        stop_flag.store(true);
      }
    }

    Log::info("Retrying ", ++retry_count, " times");
    std::this_thread::sleep_for(std::chrono::milliseconds(retry_ms));
    retry_ms = std::min(retry_ms * 2, static_cast<uint64_t>(5000));
  } while (true);

  return 0;
}
