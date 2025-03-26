#ifndef PLOTOP_LOG_H
#define PLOTOP_LOG_H

#include <iostream>

class Log {
 public:
  enum Level {
    ERROR,
    INFO,
    DEBUG,
  };

 public:
  static void set_level(Level level) { level_ = level; }

  template <typename... Args> static void error(Args &&...args) {
    if (level_ >= ERROR) {
      log_error_("[ERROR] ", std::forward<Args>(args)...);
    }
  }
  template <typename... Args> static void info(Args &&...args) {
    if (level_ >= INFO) {
      log_info_("[INFO] ", std::forward<Args>(args)...);
    }
  }

  template <typename... Args> static void debug(Args &&...args) {
    if (level_ >= DEBUG) {
      log_info_("[DEBUG] ", std::forward<Args>(args)...);
    }
  }

 private:
  template <typename... Args> static void log_error_(Args &&...args) { (std::cerr << ... << args) << std::endl; }

  template <typename... Args> static void log_info_(Args &&...args) { (std::cout << ... << args) << std::endl; }

 private:
  static Level level_;
};
inline Log::Level Log::level_ = Log::INFO;

#endif  // PLOTOP_LOG_H
