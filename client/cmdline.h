#ifndef PLOTOP_CMDLINE_H
#define PLOTOP_CMDLINE_H

#include <algorithm>
#include <cstdint>
#include <functional>
#include <iostream>
#include <list>
#include <string>
#include <unordered_map>
#include <vector>

class Cmdline {
  struct ArgumentInfo {
    char short_name;
    std::string name;
    std::string description;
    std::string default_value;
    bool repeatable;
  };

 public:
  Cmdline() {
    arguments_["h"] = arguments_["help"] = [&](const std::string &) { help_requested_ = true; };
    args_info_.push_back({'h', "help", "Show this help message and exit", "", false});
  }
  ~Cmdline() {}

 public:
  template <typename T, typename std::enable_if<std::is_integral_v<T>, int>::type = 0>
  void add_argument(char short_name, const std::string &name, T &arg, T default_value,
                    const std::string &description = "") {
    arg = default_value;
    arguments_[std::string(1, short_name)] =
        arguments_[name] = [&](const std::string &value) { arg = static_cast<T>(std::stoi(value)); };
    args_info_.push_back({short_name, name, description, std::to_string(default_value), false});
  }

  template <typename T, typename std::enable_if<std::is_floating_point_v<T>, int>::type = 0>
  void add_argument(char short_name, const std::string &name, T &arg, T default_value,
                    const std::string &description = "") {
    arg = default_value;
    arguments_[std::string(1, short_name)] =
        arguments_[name] = [&](const std::string &value) { arg = static_cast<T>(std::stod(value)); };
    args_info_.push_back({short_name, name, description, std::to_string(default_value), false});
  }

  void add_argument(char short_name, const std::string &name, std::string &arg, const std::string &default_value,
                    const std::string &description = "") {
    arg = default_value;
    arguments_[std::string(1, short_name)] = arguments_[name] = [&](const std::string &value) { arg = value; };
    args_info_.push_back({short_name, name, description, default_value, false});
  }

  void add_argument(char short_name, const std::string &name, std::list<std::string> &arg,
                    const std::string &description = "") {
    arguments_[std::string(1, short_name)] = arguments_[name] = [&](const std::string &value) { arg.emplace_back(value); };
    args_info_.push_back({short_name, name, description, "", true});
  }

  void add_argument(char short_name, const std::string &name, std::list<int32_t> &arg,
                    const std::string &description = "") {
    arguments_[std::string(1, short_name)] = arguments_[name] = [&](const std::string &value) {
      arg.emplace_back(static_cast<int32_t>(std::stoi(value)));
    };
    args_info_.push_back({short_name, name, description, "", true});
  }

  bool parse(int32_t argc, char **argv) {
    if (argc > 0) {
      program_name_ = argv[0];
      const auto pos = program_name_.find_last_of("/\\");
      if (pos != std::string::npos) {
        program_name_ = program_name_.substr(pos + 1);
      }
    }

    for (int32_t i = 1; i < argc; i++) {
      std::string name = argv[i];
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

      if (name == "h" || name == "help") {
        help_requested_ = true;
        continue;
      }

      for (i++; i < argc; i++) {
        if (argv[i][0] == '-') {
          i--;
          break;
        }
        try {
          it->second(argv[i]);
        } catch (const std::exception &) {
          std::cerr << "[ERROR] Invalid value for -" << name << ": " << argv[i] << std::endl;
          return false;
        }
      }
    }

    if (help_requested_) {
      help();
      return false;
    }
    return true;
  }

  void help() const {
    std::cout << "Usage: " << program_name_ << " [options]\n\n";
    std::cout << "Options:\n";

    size_t max_width = 0;
    std::vector<std::string> opts;
    for (const auto &info : args_info_) {
      std::string opt = std::string("  -") + info.short_name + ", --" + info.name;
      if (info.repeatable || !info.default_value.empty()) {
        opt += " <arg>";
      }
      opts.push_back(opt);
      max_width = std::max(max_width, opt.size());
    }

    for (size_t i = 0; i < args_info_.size(); i++) {
      const auto &info = args_info_[i];
      std::cout << opts[i];
      std::cout << std::string(max_width - opts[i].size() + 2, ' ');
      std::cout << info.description;
      if (!info.default_value.empty()) {
        std::cout << " (default: " << info.default_value << ")";
      } else if (info.repeatable) {
        std::cout << " (repeatable)";
      }
      std::cout << "\n";
    }
  }

 private:
  std::unordered_map<std::string, std::function<void(const std::string &)>> arguments_;
  std::vector<ArgumentInfo> args_info_;
  std::string program_name_ = "plotop";
  bool help_requested_ = false;
};

#endif  // PLOTOP_CMDLINE_H
