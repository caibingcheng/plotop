#ifndef PLOTOP_PACKET_H
#define PLOTOP_PACKET_H

#include <chrono>
#include <list>
#include <memory>
#include <string>

#include "jsonify.h"
#include "log.h"

struct Thread {
  int32_t tid;
  int64_t priority;
  uint64_t cpu_user;
  uint64_t cpu_system;
};
struct Process {
  int32_t pid;
  std::string name;
  uint64_t memory;
  uint64_t cpu_user;
  uint64_t cpu_system;
  std::list<Thread> threads;
};
struct Stats {
  std::list<uint64_t> processor_frequency;
  std::list<uint64_t> cpu_user;
  std::list<uint64_t> cpu_system;
  std::list<uint64_t> cpu_idle;
  std::list<uint64_t> cpu_iowait;
  std::list<uint64_t> cpu_irq;
  std::list<uint64_t> cpu_softirq;
  uint64_t total_memory;
  uint64_t free_memory;
  std::list<Process> processes;
};

inline Jsonify &to_jsonify(Jsonify &jsonify, const Thread &thread) {
  jsonify["tid"] = thread.tid;
  jsonify["priority"] = thread.priority;
  jsonify["cpu_user"] = thread.cpu_user;
  jsonify["cpu_system"] = thread.cpu_system;
  return jsonify;
}

inline Jsonify &to_jsonify(Jsonify &jsonify, const Process &process) {
  jsonify["pid"] = process.pid;
  jsonify["name"] = process.name;
  jsonify["memory"] = process.memory;
  jsonify["cpu_user"] = process.cpu_user;
  jsonify["cpu_system"] = process.cpu_system;
  jsonify["threads"] = process.threads;
  return jsonify;
}

inline Jsonify &to_jsonify(Jsonify &jsonify, const Stats &stats) {
  const auto ts = std::chrono::system_clock::now();
  const auto ts_ms = std::chrono::duration_cast<std::chrono::milliseconds>(ts.time_since_epoch()).count();
  jsonify["timestamp"] = ts_ms;
  jsonify["processor_frequency"] = stats.processor_frequency;
  jsonify["cpu_user"] = stats.cpu_user;
  jsonify["cpu_system"] = stats.cpu_system;
  jsonify["cpu_idle"] = stats.cpu_idle;
  jsonify["cpu_iowait"] = stats.cpu_iowait;
  jsonify["cpu_irq"] = stats.cpu_irq;
  jsonify["cpu_softirq"] = stats.cpu_softirq;
  jsonify["total_memory"] = stats.total_memory;
  jsonify["free_memory"] = stats.free_memory;
  jsonify["processes"] = stats.processes;
  return jsonify;
}

class Packet {
 public:
  Packet();
  ~Packet();

 public:
  void collate(Stats &, const std::list<std::string> &);

 public:
  std::string to_json(const Stats &stats) const {
    const auto jsonify = Jsonify(stats).to_string() + "\r\n";  // \n is a delimiter
    // Log::debug("jsonify: ", jsonify);
    return jsonify;
  }

 private:
  template <typename T> std::string to_json_(const T &value) const { return std::to_string(value); }

  std::string to_json_(const std::string &value) const { return "\"" + value + "\""; }

  template <typename T> std::string to_json_(const std::list<T> &value) const {
    std::string json = "[";
    for (const auto &v : value) {
      json += to_json_(v) + ",";
    }
    if (!value.empty()) {
      json.pop_back();
    }
    json += "]";
    return json;
  }

  std::string to_json_(const Thread &value) const {
    std::string json = "{";
    json += "\"tid\":" + to_json_(value.tid) + ",";
    json += "}";
    return json;
  }

  std::string to_json_(const Process &value) const {
    std::string json = "{";
    json += "\"pid\":" + to_json_(value.pid) + ",";
    json += "\"name\":" + to_json_(value.name) + ",";
    json += "\"memory\":" + to_json_(value.memory) + ",";
    json += "\"threads\":" + to_json_(value.threads);
    json += "}";
    return json;
  }

  std::string to_json_(const Stats &value) const {
    const auto ts = std::chrono::system_clock::now();
    const auto ts_ms = std::chrono::duration_cast<std::chrono::milliseconds>(ts.time_since_epoch()).count();
    std::string json = "{";
    json += "\"timestamp\":" + std::to_string(ts_ms) + ",";
    json += "\"processor_frequency\":" + to_json_(value.processor_frequency) + ",";
    json += "\"total_memory\":" + to_json_(value.total_memory) + ",";
    json += "\"free_memory\":" + to_json_(value.free_memory) + ",";
    json += "\"processes\":" + to_json_(value.processes) + ",";

    // just astimate json length
    const int64_t json_length = (json.size() + 1023) / 1024;
    json += "\"json_length\":" + std::to_string(json_length);

    json += "}";
    return json;
  }

 private:
  class ImplPacket;
  std::unique_ptr<ImplPacket> impl_;
};

#endif  // PLOTOP_PACKET_H
