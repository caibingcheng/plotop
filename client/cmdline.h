#ifndef PLOTOP_CMDLINE_H
#define PLOTOP_CMDLINE_H

#include <cstdint>
#include <functional>
#include <string>
#include <unordered_map>

class Cmdline {
  template <typename T> struct Bypass {
    using type = T;
  };

 public:
  Cmdline() {}
  ~Cmdline() {}

 public:
  template <typename T, typename std::enable_if<std::is_integral_v<T>, int>::type = 0>
  void add_argument(const std::string &name, T &arg, T default_value) {
    arg = default_value;
    arguments_[name] = [&](const std::string &value) { arg = static_cast<T>(std::stoi(value)); };
  }

  template <typename T, typename std::enable_if<std::is_floating_point_v<T>, int>::type = 0>
  void add_argument(const std::string &name, T &arg, T default_value) {
    arg = default_value;
    arguments_[name] = [&](const std::string &value) { arg = static_cast<T>(std::stod(value)); };
  }

  template <typename T, typename std::enable_if<decltype(std::declval<T>().begin(), std::declval<T>().end(), std::true_type{})::value, int>::type = 0>
  void add_argument(const std::string &name, T &arg, const T &default_value) {
    arg.clear();
    arguments_[name] = [&](const std::string &value) {
      arg.emplace_back(value);
    };
  }

  void add_argument(const std::string &name, std::string &arg, const std::string &default_value) {
    arg = default_value;
    arguments_[name] = [&](const std::string &value) { arg = value; };
  }

  void parse(int32_t argc, char **argv) {
    for (int32_t i = 1; i < argc; i++) {
      std::string name = argv[i];
      // remove leading '--' or '-'
      while (name.size() > 0 && (name[0] == '-')) {
        name = name.substr(1);
      }
      if (name.empty()) {
        continue;
      }
      auto it = arguments_.find(name);
      if (it == arguments_.end()) {
        continue;
      }

      std::string arg;
      for (i++; i < argc; i++) {
        if (argv[i][0] == '-') {
          i--;
          break;
        }
        arg += argv[i];
      }
      it->second(arg);
    }
  }

 private:
  std::unordered_map<std::string, std::function<void(const std::string &)>> arguments_;
};

#endif  // PLOTOP_CMDLINE_H
