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
  const auto ts = std::chrono::steady_clock::now();
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

struct ProcessInfo {
  int32_t pid;
  std::string name;
};

inline Jsonify &to_jsonify(Jsonify &jsonify, const ProcessInfo &item) {
  jsonify["pid"] = item.pid;
  jsonify["name"] = item.name;
  return jsonify;
}

class Packet {
 public:
  Packet();
  ~Packet();

 public:
  void collate(Stats &, const std::list<int32_t> &);

 public:
  std::string to_json(const Stats &stats) const {
    const auto ts = std::chrono::steady_clock::now();
    const auto ts_ms = std::chrono::duration_cast<std::chrono::milliseconds>(ts.time_since_epoch()).count();
    Jsonify jsonify;
    jsonify["type"] = "stats";
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
    return jsonify.to_string() + "\n";
  }

  std::string to_heartbeat() const {
    const auto ts = std::chrono::steady_clock::now();
    const auto ts_ms = std::chrono::duration_cast<std::chrono::milliseconds>(ts.time_since_epoch()).count();
    Jsonify jsonify;
    jsonify["type"] = "heartbeat";
    jsonify["timestamp"] = ts_ms;
    return jsonify.to_string() + "\n";
  }

  std::string to_process_list(const std::list<std::pair<int32_t, std::string>> &processes) const {
    const auto ts = std::chrono::steady_clock::now();
    const auto ts_ms = std::chrono::duration_cast<std::chrono::milliseconds>(ts.time_since_epoch()).count();
    std::list<ProcessInfo> items;
    for (const auto &process : processes) {
      items.push_back({process.first, process.second});
    }
    Jsonify jsonify;
    jsonify["type"] = "process_list";
    jsonify["timestamp"] = ts_ms;
    jsonify["processes"] = items;
    return jsonify.to_string() + "\n";
  }

  std::string to_filter_ack(int32_t matched_count) const {
    const auto ts = std::chrono::steady_clock::now();
    const auto ts_ms = std::chrono::duration_cast<std::chrono::milliseconds>(ts.time_since_epoch()).count();
    Jsonify jsonify;
    jsonify["type"] = "filter_ack";
    jsonify["timestamp"] = ts_ms;
    jsonify["matched_count"] = matched_count;
    return jsonify.to_string() + "\n";
  }

  std::list<ProcessInfo> get_process_list() const;
  bool process_list_changed() const;

 private:
  class ImplPacket;
  std::unique_ptr<ImplPacket> impl_;
};

#endif  // PLOTOP_PACKET_H
