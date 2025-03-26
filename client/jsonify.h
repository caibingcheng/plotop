#ifndef PLOTOP_JSONIFY_H
#define PLOTOP_JSONIFY_H

#include <algorithm>
#include <memory>
#include <string>
#include <unordered_map>
#include <variant>

class Jsonify;
class Jsonify {
  enum class Type {
    STRING,
    LIST,
    JSONIFY,
  };

 public:
  template <typename T> friend Jsonify &to_jsonify(Jsonify &jsonify, const T &value) {
    jsonify = Jsonify(value);
    return jsonify;
  }

 public:
  Jsonify() : type_(Type::JSONIFY) {}
  Jsonify(const std::string &value) : type_(Type::STRING), value_(value) {}
  Jsonify(const char *value) : type_(Type::STRING), value_(value) {}
  Jsonify(const char value) : type_(Type::STRING), value_(std::string(1, value)) {}
  Jsonify(const bool value) : type_(Type::STRING), value_(value ? "true" : "false") {}
  Jsonify(const int8_t value) : type_(Type::STRING), value_(std::to_string(value)) {}
  Jsonify(const int32_t value) : type_(Type::STRING), value_(std::to_string(value)) {}
  Jsonify(const int64_t value) : type_(Type::STRING), value_(std::to_string(value)) {}
  Jsonify(const uint8_t value) : type_(Type::STRING), value_(std::to_string(value)) {}
  Jsonify(const uint32_t value) : type_(Type::STRING), value_(std::to_string(value)) {}
  Jsonify(const uint64_t value) : type_(Type::STRING), value_(std::to_string(value)) {}
  Jsonify(const float value) : type_(Type::STRING), value_(std::to_string(value)) {}
  Jsonify(const double value) : type_(Type::STRING), value_(std::to_string(value)) {}

  template <typename T> Jsonify(const T &value) : type_(Type::JSONIFY) { to_jsonify(*this, value); }
  template <typename T> Jsonify(const std::list<T> &list) : type_(Type::LIST) {
    list_.clear();
    for (const auto &value : list) {
      list_.push_back(std::make_shared<Jsonify>(value));
    }
  }

 public:
  Jsonify &operator[](const std::string &key) {
    if (jsonify_.find(key) == jsonify_.end()) {
      jsonify_[key] = std::make_shared<Jsonify>();
    }
    return *jsonify_[key];
  }

  template <typename T> Jsonify &operator=(const T &value) {
    *this = Jsonify(value);
    return *this;
  }

 public:
  std::string to_string() const {
    switch (type_) {
    case Type::STRING:
      return to_string_string_();
    case Type::LIST:
      return to_string_list_();
    case Type::JSONIFY:
      return to_string_jsonify_();
    default:
      abort();
    }
  }

 private:
  bool is_number_(const std::string &value) const {
    try {
      std::stod(value);
      return true;
    } catch (...) {
      return false;
    }
  }

  std::string to_string_string_() const {
    if (is_number_(value_)) {
      return value_;
    }

    // replace \x00 and etc with ' '
    std::string jsonify = value_;
    std::replace_if(jsonify.begin(), jsonify.end(), [](const char c) { return c < 32; }, ' ');
    // replace " with "\""
    std::replace_if(jsonify.begin(), jsonify.end(), [](const char c) { return c == '"'; }, '\\');

    return "\"" + jsonify + "\"";
  }

  std::string to_string_list_() const {
    std::string jsonify = "[";
    for (const auto &value : list_) {
      jsonify += value->to_string() + ",";
    }
    if (!list_.empty()) {
      jsonify.pop_back();
    }
    jsonify += "]";
    return jsonify;
  }

  std::string to_string_jsonify_() const {
    std::string jsonify = "{";
    for (const auto &[key, value] : jsonify_) {
      jsonify += "\"" + key + "\":" + value->to_string() + ",";
    }
    if (!jsonify_.empty()) {
      jsonify.pop_back();
    }
    jsonify += "}";
    return jsonify;
  }

 private:
  Type type_;
  std::string value_;
  std::list<std::shared_ptr<Jsonify>> list_;
  std::unordered_map<std::string, std::shared_ptr<Jsonify>> jsonify_;
};

#endif  // PLOTOP_JSONIFY_H
