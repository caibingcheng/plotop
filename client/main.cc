#include <cstdint>
#include <list>
#include <string>
#include <thread>

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
  cmdline.add_argument('i', "ip", args.address, "127.0.0.1");
  cmdline.add_argument('p', "port", args.port, 8001);
  cmdline.add_argument('l', "level", args.level, 2);
  cmdline.add_argument('d', "duration", args.duration, 3);
  cmdline.add_argument('P', "pattern", args.patterns);
  cmdline.parse(argc, argv);
  Log::set_level(static_cast<Log::Level>(args.level));

  static uint64_t retry_count = 0;
  do {
    std::unique_ptr<Packet> packet(new Packet());
    std::unique_ptr<Network> network(new Network(args.address, args.port));
    if (network->ready()) {
      Interval interval(args.duration, [&]() {
        Stats stats;
        packet->collate(stats, args.patterns);
        network->send(packet->to_json(stats));
      });

      interval.wait();
    }

    Log::info("Retrying ", ++retry_count, " times");
    std::this_thread::sleep_for(std::chrono::milliseconds(1000));
  } while (true);

  return 0;
}
