#include "packet.h"

#include <dirent.h>

#include <cstdint>
#include <fstream>
#include <list>
#include <regex>
#include <string>

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
  uint64_t user;
  uint64_t nice;
  uint64_t system;
  uint64_t idle;
  uint64_t iowait;
  uint64_t irq;
  uint64_t softirq;
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
      Log::error("Failed to open ", file);
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
      Log::error("Failed to open ", get_proc());
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
      Log::error("Failed to open ", get_proc_tid(pid));
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

  std::list<Thread> get_threads_(int32_t pid) {
    std::list<Thread> threads;
    for (const auto tid : get_tids_(pid)) {
      const std::string stat_str = get_string_from_file_(get_proc_tid_stat(pid, tid));
      if (stat_str.empty()) {
        continue;
      }
      Stat stat;
      sscanf(stat_str.c_str(),
             "%d %s %c %d %d %d %d %d %u %lu %lu %lu %lu %lu %lu %ld %ld %ld %ld %ld %ld %lu %lu %ld %lu %lu %lu %lu "
             "%lu %lu %lu %lu %lu %lu %lu %lu %lu %d %u %u %u %lu %ld %lu %lu %lu %lu %lu %lu %lu %lu %d",
             &stat.pid, stat.comm, &stat.state, &stat.ppid, &stat.pgrp, &stat.session, &stat.tty_nr, &stat.tpgid,
             &stat.flags, &stat.minflt, &stat.cminflt, &stat.majflt, &stat.cmajflt, &stat.utime, &stat.stime,
             &stat.cutime, &stat.cstime, &stat.priority, &stat.nice, &stat.num_threads, &stat.itrealvalue,
             &stat.starttime, &stat.vsize, &stat.rss, &stat.rsslim, &stat.startcode, &stat.endcode, &stat.startstack,
             &stat.kstkesp, &stat.kstkeip, &stat.signal, &stat.blocked, &stat.sigignore, &stat.sigcatch, &stat.wchan,
             &stat.nswap, &stat.cnswap, &stat.exit_signal, &stat.processor, &stat.rt_priority, &stat.policy,
             &stat.delayacct_blkio_ticks, &stat.guest_time, &stat.cguest_time, &stat.start_data, &stat.end_data,
             &stat.start_brk, &stat.arg_start, &stat.arg_end, &stat.env_start, &stat.env_end, &stat.exit_code);

      Thread thread;
      thread.tid = tid;
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
      sscanf(stat_str.c_str(),
             "%d %s %c %d %d %d %d %d %u %lu %lu %lu %lu %lu %lu %ld %ld %ld %ld %ld %ld %lu %lu %ld %lu %lu %lu %lu "
             "%lu %lu %lu %lu %lu %lu %lu %lu %lu %d %u %u %u %lu %ld %lu %lu %lu %lu %lu %lu %lu %lu %d",
             &stat.pid, stat.comm, &stat.state, &stat.ppid, &stat.pgrp, &stat.session, &stat.tty_nr, &stat.tpgid,
             &stat.flags, &stat.minflt, &stat.cminflt, &stat.majflt, &stat.cmajflt, &stat.utime, &stat.stime,
             &stat.cutime, &stat.cstime, &stat.priority, &stat.nice, &stat.num_threads, &stat.itrealvalue,
             &stat.starttime, &stat.vsize, &stat.rss, &stat.rsslim, &stat.startcode, &stat.endcode, &stat.startstack,
             &stat.kstkesp, &stat.kstkeip, &stat.signal, &stat.blocked, &stat.sigignore, &stat.sigcatch, &stat.wchan,
             &stat.nswap, &stat.cnswap, &stat.exit_signal, &stat.processor, &stat.rt_priority, &stat.policy,
             &stat.delayacct_blkio_ticks, &stat.guest_time, &stat.cguest_time, &stat.start_data, &stat.end_data,
             &stat.start_brk, &stat.arg_start, &stat.arg_end, &stat.env_start, &stat.env_end, &stat.exit_code);

      std::string name(stat.comm);
      bool match = false;
      for (const auto &pattern : patterns) {
        if (std::regex_match(name, std::regex(pattern))) {
          match = true;
          break;
        }
      }
      if (!match) {
        continue;
      }

      const std::string statm_str = get_string_from_file_(get_proc_pid_mem(pid));
      if (statm_str.empty()) {
        continue;
      }
      StatM statm;
      sscanf(statm_str.c_str(), "%d %d %d %d %d %d %d", &statm.size, &statm.resident, &statm.shared, &statm.text,
             &statm.lib, &statm.data, &statm.dt);

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
        sscanf(line.c_str(), "%lu %lu %lu %lu %lu %lu %lu", &cpu.user, &cpu.nice, &cpu.system, &cpu.idle,
               &cpu.iowait, &cpu.irq, &cpu.softirq);
        cpus.push_back(cpu);
      }
    }

    return cpus;
  }
};

Packet::Packet() : impl_(new ImplPacket()) {}
Packet::~Packet() {}

void Packet::collate(Stats &stats, const std::list<std::string> &patterns) { impl_->collate(stats, patterns); }
