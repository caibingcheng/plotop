#ifndef PLOTOP_INTERVAL_H
#define PLOTOP_INTERVAL_H

#include <atomic>
#include <chrono>
#include <functional>
#include <thread>

#include "log.h"

class Interval {
 public:
  Interval(int64_t start_offset_s, int64_t interval_s, std::function<void()> task)
      : start_offset_ms_(start_offset_s), interval_ms_(interval_s), stop_(false), task_(task) {
    last_time_ = std::chrono::steady_clock::now();
    next_time_ = last_time_ + std::chrono::seconds(start_offset_s);
    Log::debug("Interval start_offset_s: ", start_offset_s, " interval_s: ", interval_s);
    thread_ = std::thread(&Interval::run, this);
  }

  Interval(int64_t interval_s, std::function<void()> task) : Interval(0, interval_s, task) {}

  ~Interval() {
    stop_ = true;
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
    try {
      while (!stop_) {
        now_ = std::chrono::steady_clock::now();
        if (now_ >= next_time_) {
          try {
            task_();
          } catch (const std::exception &e) {
            Log::error("Error accurred: ", e.what());
            return;
          }
          last_time_ = now_;
          next_time_ = last_time_ + std::chrono::seconds(interval_ms_);
        }

        const auto sleep_time = next_time_ - std::chrono::steady_clock::now();
        if (sleep_time.count() > 0) {
          auto sleep_ms = std::chrono::duration_cast<std::chrono::milliseconds>(sleep_time).count();
          if (sleep_ms > 100) sleep_ms = 100;
          std::this_thread::sleep_for(std::chrono::milliseconds(sleep_ms));
        }
      }
    } catch (const std::exception &e) {
      Log::error("Interval run exception: ", e.what());
      throw;
    }
  }

 private:
  int64_t start_offset_ms_;
  int64_t interval_ms_;
  std::chrono::time_point<std::chrono::steady_clock> last_time_;
  std::chrono::time_point<std::chrono::steady_clock> next_time_;
  std::chrono::time_point<std::chrono::steady_clock> now_;

  std::atomic<bool> stop_;
  std::thread thread_;
  std::function<void()> task_;
};

#endif  // PLOTOP_INTERVAL_H
