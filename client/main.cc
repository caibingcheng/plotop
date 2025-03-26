#include <cstdint>
#include <string>
#include <list>

#include "cmdline.h"
#include "internval.h"
#include "network.h"
#include "packet.h"

struct Arguments {
  std::string address;
  int32_t port;
  int32_t level;
  int32_t duration;
  std::list<std::string> patterns;
};

int32_t main(int32_t argc, char **argv) {
  Arguments args;
  Cmdline cmdline;
  cmdline.add_argument("address", args.address, "127.0.0.1");
  cmdline.add_argument("port", args.port, 8080);
  cmdline.add_argument("level", args.level, 2);
  cmdline.add_argument("duration", args.duration, 3000);
  cmdline.add_argument("pattern", args.patterns, {"^.*$"});
  cmdline.parse(argc, argv);
  Log::set_level(static_cast<Log::Level>(args.level));

  Stats stats;
  Packet packet;
  Network network(args.address, args.port);
  if (!network.ready()) {
    return 1;
  }

  Interval interval(args.duration, [&]() {
    packet.collate(stats, args.patterns);
    network.send(packet.to_json(stats));
  });

  interval.wait();
  return 0;
}
