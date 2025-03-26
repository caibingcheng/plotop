#ifndef PLOTOP_NETWORK_H
#define PLOTOP_NETWORK_H

#include <memory>
#include <string>

class Network {
 public:
  Network(const std::string &address, int32_t port);
  ~Network();

 public:
  void send(const std::string &data);
  bool ready() const;

 private:
  class ImplNetwork;
  std::unique_ptr<ImplNetwork> impl_;
};

#endif  // PLOTOP_NETWORK_H
