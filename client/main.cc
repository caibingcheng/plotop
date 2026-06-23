#include <cstdint>
#include <list>
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
  std::list<std::string> patterns;
  std::list<int32_t> pids;
};

template <typename T>
std::string join_list(const std::list<T> &values) {
  std::ostringstream oss;
  oss << "[";
  for (auto it = values.begin(); it != values.end(); ++it) {
    if (it != values.begin()) {
      oss << ", ";
    }
    oss << *it;
  }
  oss << "]";
  return oss.str();
}

int32_t main(int32_t argc, char **argv) {
  Arguments args;
  Cmdline cmdline;
  cmdline.add_argument('i', "ip", args.address, "127.0.0.1", "Server IP address");
  cmdline.add_argument('p', "port", args.port, 8001, "Server port");
  cmdline.add_argument('l', "level", args.level, 2, "Log level: 0=ERROR, 1=INFO, 2=DEBUG");
  cmdline.add_argument('d', "duration", args.duration, 3, "Sampling interval in seconds");
  cmdline.add_argument('P', "pattern", args.patterns, "Filter processes by name substring");
  cmdline.add_argument('I', "pid", args.pids, "Filter processes by PID");

  if (!cmdline.parse(argc, argv)) {
    return 0;
  }
  Log::set_level(static_cast<Log::Level>(args.level));

  static uint64_t retry_count = 0;
  uint64_t retry_ms = 100;
  bool filter_active_logged = false;
  size_t last_matched_count = static_cast<size_t>(-1);

  do {
    std::unique_ptr<Packet> packet(new Packet());
    std::unique_ptr<Network> network(new Network(args.address, args.port));
    if (network->ready()) {
      retry_ms = 100;

      if (!filter_active_logged && (!args.patterns.empty() || !args.pids.empty())) {
        Log::info("Filter active: name=", join_list(args.patterns), ", pid=", join_list(args.pids));
        filter_active_logged = true;
      }

      Interval interval(args.duration, [&]() {
        Stats stats;
        packet->collate(stats, args.patterns, args.pids);
        network->send(packet->to_json(stats));

        if (!args.patterns.empty() || !args.pids.empty()) {
          const auto matched_count = stats.processes.size();
          if (matched_count != last_matched_count) {
            Log::info("Matched ", matched_count, " process(es)");
            if (matched_count == 0) {
              Log::info("No process matched filter");
            }
            last_matched_count = matched_count;
          }
        }
      });

      interval.wait();
    }

    Log::info("Retrying ", ++retry_count, " times");
    std::this_thread::sleep_for(std::chrono::milliseconds(retry_ms));
    retry_ms = std::min(retry_ms * 2, static_cast<uint64_t>(5000));
  } while (true);

  return 0;
}
