#ifndef PLOTOP_INTERVAL_H
#define PLOTOP_INTERVAL_H

#include <chrono>
#include <condition_variable>
#include <functional>
#include <mutex>
#include <thread>

#include "log.h"

class Interval {
 public:
  Interval(int64_t start_offset_s, int64_t interval_s, std::function<void()> task)
      : start_offset_ms_(start_offset_s), interval_ms_(interval_s), stop_(false), task_(task) {
    last_time_ = std::chrono::system_clock::now();
    next_time_ = last_time_ + std::chrono::seconds(start_offset_s);
    Log::debug("Interval start_offset_s: ", start_offset_s, " interval_s: ", interval_s);
    thread_ = std::thread(&Interval::run, this);
  }

  Interval(int64_t interval_s, std::function<void()> task) : Interval(0, interval_s, task) {}

  ~Interval() {
    if (thread_.joinable()) {
      thread_.join();
    }
  }

 public:
  void wait() {
    if (thread_.joinable()) {
      thread_.join();
    }
  }

  void stop() { stop_ = true; }

 private:
  void run() {
    while (!stop_) {
      now_ = std::chrono::system_clock::now();
      if (now_ >= next_time_) {
        task_();
        last_time_ = now_;
        next_time_ = last_time_ + std::chrono::seconds(interval_ms_);
      }

      const auto sleep_time = next_time_ - std::chrono::system_clock::now();
      if (sleep_time.count() > 0) {
        // Log::debug("Interval sleep: ", sleep_time.count());
        std::unique_lock<std::mutex> lock(mutex_);
        cv_.wait_for(lock, sleep_time, [this]() { return stop_; });
      }
    }
  }

 private:
  int64_t start_offset_ms_;
  int64_t interval_ms_;
  std::chrono::time_point<std::chrono::system_clock> last_time_;
  std::chrono::time_point<std::chrono::system_clock> next_time_;
  std::chrono::time_point<std::chrono::system_clock> now_;

  bool stop_;
  std::thread thread_;
  std::mutex mutex_;
  std::condition_variable cv_;
  std::function<void()> task_;
};

#endif  // PLOTOP_INTERVAL_H
