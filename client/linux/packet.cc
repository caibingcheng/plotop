#include "packet.h"

#include <dirent.h>

#include <cstdint>
#include <fstream>
#include <list>
#include <regex>
#include <string>
#include <string_view>

#include "log.h"

struct StatM {
  int32_t size;
  int32_t resident;
  int32_t shared;
  int32_t text;
  int32_t lib;
  int32_t data;
  int32_t dt;
};

struct Stat {
  int32_t pid;
  char comm[4096];
  char state;
  int32_t ppid;
  int32_t pgrp;
  int32_t session;
  int32_t tty_nr;
  int32_t tpgid;
  uint32_t flags;
  uint64_t minflt;
  uint64_t cminflt;
  uint64_t majflt;
  uint64_t cmajflt;
  uint64_t utime;
  uint64_t stime;
  int64_t cutime;
  int64_t cstime;
  int64_t priority;
  int64_t nice;
  int64_t num_threads;
  int64_t itrealvalue;
  uint64_t starttime;
  uint64_t vsize;
  int64_t rss;
  uint64_t rsslim;
  uint64_t startcode;
  uint64_t endcode;
  uint64_t startstack;
  uint64_t kstkesp;
  uint64_t kstkeip;
  uint64_t signal;
  uint64_t blocked;
  uint64_t sigignore;
  uint64_t sigcatch;
  uint64_t wchan;
  uint64_t nswap;
  uint64_t cnswap;
  int32_t exit_signal;
  int32_t processor;
  uint32_t rt_priority;
  uint32_t policy;
  uint64_t delayacct_blkio_ticks;
  uint64_t guest_time;
  int64_t cguest_time;
  uint64_t start_data;
  uint64_t end_data;
  uint64_t start_brk;
  uint64_t arg_start;
  uint64_t arg_end;
  uint64_t env_start;
  uint64_t env_end;
  int32_t exit_code;
};

struct CPUsage {
  char cpu_name[32];
  uint64_t user;
  uint64_t nice;
  uint64_t system;
  uint64_t idle;
  uint64_t iowait;
  uint64_t irq;
  uint64_t softirq;
  uint64_t steal;
  uint64_t guest;
  uint64_t guest_nice;
};

class Packet::ImplPacket {
  static const std::string get_proc() { return "/proc"; }
  static const std::string get_proc_cpuinfo() { return "/proc/cpuinfo"; }
  static const std::string get_proc_stat() { return "/proc/stat"; }
  static const std::string get_proc_meminfo() { return "/proc/meminfo"; }
  static const std::string get_proc_pid_mem(int32_t pid) { return "/proc/" + std::to_string(pid) + "/statm"; }
  static const std::string get_proc_pid_stat(int32_t pid) { return "/proc/" + std::to_string(pid) + "/stat"; }
  static const std::string get_proc_pid_status(int32_t pid) { return "/proc/" + std::to_string(pid) + "/status"; }
  static const std::string get_proc_pid_cmdline(int32_t pid) { return "/proc/" + std::to_string(pid) + "/cmdline"; }
  static const std::string get_proc_tid(int32_t pid) { return "/proc/" + std::to_string(pid) + "/task"; }
  static const std::string get_proc_tid_stat(int32_t pid, int32_t tid) {
    return "/proc/" + std::to_string(pid) + "/task/" + std::to_string(tid) + "/stat";
  }
  static const std::string get_proc_tid_status(int32_t pid, int32_t tid) {
    return "/proc/" + std::to_string(pid) + "/task/" + std::to_string(tid) + "/status";
  }

 public:
  ImplPacket() {}
  ~ImplPacket() {}

 public:
  void collate(Stats &stats, const std::list<std::string> &patterns) {
    stats.total_memory = get_total_memory_();
    stats.free_memory = get_free_memory_();
    stats.processes = get_processes_(patterns);
    auto summary_cpu = get_cpu_usage_();
    for (const auto &cpu : summary_cpu) {
      stats.cpu_user.push_back(cpu.user);
      stats.cpu_system.push_back(cpu.system);
      stats.cpu_idle.push_back(cpu.idle);
      stats.cpu_iowait.push_back(cpu.iowait);
      stats.cpu_irq.push_back(cpu.irq);
      stats.cpu_softirq.push_back(cpu.softirq);
    }
  }

 private:
  template <typename T> T get_key_value_from_file_(const std::string &file, const std::string &key) {
    std::ifstream ifs(file);
    if (!ifs.is_open()) {
      Log::error("Failed to open ", file);
      return T();
    }

    std::string line;
    while (std::getline(ifs, line)) {
      if (line.find(key) != std::string::npos) {
        const auto pos = line.find_first_of("0123456789");
        return std::stoll(line.substr(pos));
      }
    }

    return T();
  }

  std::string get_string_from_file_(const std::string &file) {
    std::ifstream ifs(file);
    if (!ifs.is_open()) {
      return "";
    }

    std::string line;
    std::getline(ifs, line);
    return line;
  }

  int64_t get_total_memory_() { return get_key_value_from_file_<int64_t>(get_proc_meminfo(), "MemTotal:"); }
  int64_t get_free_memory_() { return get_key_value_from_file_<int64_t>(get_proc_meminfo(), "MemFree:"); }

  std::list<int32_t> get_pids_() {
    std::list<int32_t> pids;
    DIR *dir = opendir(get_proc().c_str());
    if (dir == nullptr) {
      return pids;
    }

    struct dirent *entry;
    while ((entry = readdir(dir)) != nullptr) {
      if (entry->d_type == DT_DIR) {
        const std::string name = entry->d_name;
        if (name.find_first_not_of("0123456789") == std::string::npos) {
          pids.push_back(std::stoi(name));
        }
      }
    }

    closedir(dir);
    return pids;
  }

  std::list<int32_t> get_tids_(int32_t pid) {
    std::list<int32_t> tids;
    DIR *dir = opendir(get_proc_tid(pid).c_str());
    if (dir == nullptr) {
      return tids;
    }

    struct dirent *entry;
    while ((entry = readdir(dir)) != nullptr) {
      if (entry->d_type == DT_DIR) {
        const std::string name = entry->d_name;
        if (name.find_first_not_of("0123456789") == std::string::npos) {
          tids.push_back(std::stoi(name));
        }
      }
    }

    closedir(dir);
    return tids;
  }

  bool parse_stat_(const std::string &stat_str, Stat &stat) {
    std::string_view stat_view(stat_str);
    std::string comm_str(stat_str.substr(0, stat_str.find_last_of(")") + 1));
    const auto pid_comm_count = sscanf(comm_str.c_str(), "%d %s", &stat.pid, stat.comm);
    if (pid_comm_count != 2) {
      Log::error("Failed to parse ", stat_str, " expected ", 2, " got ", pid_comm_count);
      return false;
    }

    auto other_view = stat_view.substr(stat_view.find_last_of(")") + 1);
    other_view = other_view.substr(other_view.find_first_not_of(" \t"));
    const auto scan_count =
        sscanf(other_view.data(),
               "%c %d %d %d %d %d %u %lu %lu %lu %lu %lu %lu %ld %ld %ld %ld %ld %ld %lu %lu %ld %lu %lu %lu %lu "
               "%lu %lu %lu %lu %lu %lu %lu %lu %lu %d %u %u %u %lu %ld %lu %lu %lu %lu %lu %lu %lu %lu %d",
               &stat.state, &stat.ppid, &stat.pgrp, &stat.session, &stat.tty_nr, &stat.tpgid, &stat.flags, &stat.minflt,
               &stat.cminflt, &stat.majflt, &stat.cmajflt, &stat.utime, &stat.stime, &stat.cutime, &stat.cstime,
               &stat.priority, &stat.nice, &stat.num_threads, &stat.itrealvalue, &stat.starttime, &stat.vsize,
               &stat.rss, &stat.rsslim, &stat.startcode, &stat.endcode, &stat.startstack, &stat.kstkesp, &stat.kstkeip,
               &stat.signal, &stat.blocked, &stat.sigignore, &stat.sigcatch, &stat.wchan, &stat.nswap, &stat.cnswap,
               &stat.exit_signal, &stat.processor, &stat.rt_priority, &stat.policy, &stat.delayacct_blkio_ticks,
               &stat.guest_time, &stat.cguest_time, &stat.start_data, &stat.end_data, &stat.start_brk, &stat.arg_start,
               &stat.arg_end, &stat.env_start, &stat.env_end, &stat.exit_code);
    if (scan_count != 50) {
      Log::error("Failed to parse \"", other_view.data(), "\" expected ", 50, " got ", scan_count);
      return false;
    }
    return true;
  }

  bool parse_statm_(const std::string &statm_str, StatM &statm) {
    const auto scan_count = sscanf(statm_str.c_str(), "%d %d %d %d %d %d %d", &statm.size, &statm.resident,
                                   &statm.shared, &statm.text, &statm.lib, &statm.data, &statm.dt);
    if (scan_count != 7) {
      Log::error("Failed to parse ", statm_str, " expected ", 7, " got ", scan_count);
      return false;
    }
    return true;
  }

  bool parse_cpu_usage_(const std::string &cpu_str, CPUsage &cpu) {
    const auto scan_count =
        sscanf(cpu_str.c_str(), "%s %lu %lu %lu %lu %lu %lu %lu %lu %lu %lu", cpu.cpu_name, &cpu.user, &cpu.nice,
               &cpu.system, &cpu.idle, &cpu.iowait, &cpu.irq, &cpu.softirq, &cpu.steal, &cpu.guest, &cpu.guest_nice);
    if (scan_count != 11) {
      Log::error("Failed to parse ", cpu_str, " expected ", 11, " got ", scan_count);
      return false;
    }
    return true;
  }

  std::list<Thread> get_threads_(int32_t pid) {
    std::list<Thread> threads;
    for (const auto tid : get_tids_(pid)) {
      const std::string stat_str = get_string_from_file_(get_proc_tid_stat(pid, tid));
      if (stat_str.empty()) {
        continue;
      }
      Stat stat;
      if (!parse_stat_(stat_str, stat)) {
        continue;
      }

      Thread thread;
      thread.tid = tid;
      thread.priority = stat.priority;
      thread.cpu_user = stat.utime;
      thread.cpu_system = stat.stime;
      threads.push_back(thread);
    }

    return threads;
  }

  std::list<Process> get_processes_(const std::list<std::string> &patterns) {
    std::list<Process> processes;
    for (const auto pid : get_pids_()) {
      const std::string stat_str = get_string_from_file_(get_proc_pid_stat(pid));
      if (stat_str.empty()) {
        continue;
      }
      Stat stat;
      if (!parse_stat_(stat_str, stat)) {
        continue;
      }

      std::string name(stat.comm);
      auto pattern_match = [&](const std::string &pattern) { return name.find(pattern) != std::string::npos; };
      const bool match = patterns.empty() || std::any_of(patterns.begin(), patterns.end(), pattern_match);
      if (!match) {
        continue;
      }

      const std::string statm_str = get_string_from_file_(get_proc_pid_mem(pid));
      if (statm_str.empty()) {
        continue;
      }
      StatM statm;
      if (!parse_statm_(statm_str, statm)) {
        continue;
      }

      Process process;
      process.pid = pid;
      process.memory = statm.resident * 4;  // resident is in pages
      process.name = name;
      process.cpu_user = stat.utime;
      process.cpu_system = stat.stime;
      process.threads = get_threads_(pid);
      processes.push_back(process);
    }

    return processes;
  }

  std::list<CPUsage> get_cpu_usage_() {
    std::list<CPUsage> cpus;
    std::ifstream ifs(get_proc_stat());
    if (!ifs.is_open()) {
      Log::error("Failed to open ", get_proc_stat());
      return cpus;
    }

    std::string line;
    while (std::getline(ifs, line)) {
      if (line.find("cpu") != std::string::npos) {
        CPUsage cpu;
        if (!parse_cpu_usage_(line, cpu)) {
          continue;
        }
        cpus.push_back(cpu);
      }
    }

    return cpus;
  }
};

Packet::Packet() : impl_(new ImplPacket()) {}
Packet::~Packet() {}

void Packet::collate(Stats &stats, const std::list<std::string> &patterns) { impl_->collate(stats, patterns); }
