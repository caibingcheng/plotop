#include "network.h"

#include <arpa/inet.h>
#include <cstdint>
#include <string>
#include <sys/socket.h>
#include <unistd.h>

#include "log.h"

class Network::ImplNetwork {
 public:
  ImplNetwork(const std::string &address, int32_t port) : address_(address), port_(port) { connect_(); }
  ~ImplNetwork() {
    if (sock_ >= 0) {
      close(sock_);
    }
  }

 public:
  void send(const std::string &data) {
    if (sock_ < 0) {
      Log::error("Socket not connected");
      throw std::runtime_error("Socket not connected");
    }

    if (::send(sock_, data.c_str(), data.size(), MSG_NOSIGNAL) < 0) {
      Log::error("Failed to send data ", errno);
      throw std::runtime_error("Failed to send data " + std::to_string(errno));
    }
  }

  bool ready() const { return sock_ >= 0; }

 private:
  void connect_() {
    Log::debug("Connecting to ", address_, ":", port_);
    sock_ = socket(AF_INET, SOCK_STREAM, 0);
    if (sock_ < 0) {
      Log::error("Failed to create socket");
      return;
    }

    struct sockaddr_in server;
    server.sin_family = AF_INET;
    server.sin_port = htons(port_);
    if (inet_pton(AF_INET, address_.c_str(), &server.sin_addr) <= 0) {
      close(sock_);
      sock_ = -1;
      Log::error("Invalid address: ", address_);
      return;
    }

    if (connect(sock_, (struct sockaddr *)&server, sizeof(server)) < 0) {
      close(sock_);
      sock_ = -1;
      Log::error("Failed to connect to ", address_, ":", port_);
      return;
    }
  }

 private:
  std::string address_;
  int32_t port_;
  int32_t sock_;
};

Network::Network(const std::string &address, int32_t port) : impl_(new ImplNetwork(address, port)) {}
Network::~Network() {}

void Network::send(const std::string &data) { impl_->send(data); }
bool Network::ready() const { return impl_->ready(); }
