import argparse
from datetime import datetime, timedelta
import json
import logging
import os
import queue
import socket
import threading
import time

from flask import Flask, request, jsonify, render_template
from flask_socketio import SocketIO, emit

from server import __version__

logging.basicConfig(level=logging.INFO)

static_folder = os.path.join(os.path.dirname(__file__), "statics")
app = Flask(__name__, static_url_path='/static', static_folder=static_folder)
app.logger.setLevel(logging.INFO)
socketio = SocketIO(app, cors_allowed_origins="*",
                    ping_interval=1, ping_timeout=5, async_mode="threading")

client_subscribed = {}
client_alive = {}
client_data = {}
client_data_sequence = {}
client_outbound = {}
client_last_seen = {}
client_filter_pids = {}
client_sockets = {}
client_has_process_list = {}
client_last_process_list = {}


def handle_client(client_socket, addr):
    client_ip = addr[0]
    client_socket.settimeout(90)

    # Clean up old connection for the same IP
    old_queue = client_outbound.get(client_ip)
    old_socket = client_sockets.get(client_ip)
    if old_socket is not None and old_socket is not client_socket:
        try:
            old_socket.close()
        except Exception:
            pass
    if old_queue is not None:
        try:
            old_queue.put(None)
        except Exception:
            pass
        # Drain old queue to help old writer exit
        while True:
            try:
                old_queue.get_nowait()
            except queue.Empty:
                break

    client_sockets[client_ip] = client_socket
    client_outbound[client_ip] = queue.Queue()
    client_last_seen[client_ip] = datetime.now()
    client_alive[client_ip] = True
    client_has_process_list[client_ip] = False
    client_last_process_list[client_ip] = {}

    if client_ip not in client_data_sequence:
        client_data_sequence[client_ip] = 0
    else:
        client_data_sequence[client_ip] += 1
    client_data[client_ip] = []
    # Reset subscription window on every new raw socket connection
    client_subscribed[client_ip] = (10, datetime.now())

    socketio.emit(f'clear/{client_ip}', {}, namespace='/')
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    filename = f'log/plotop_{timestamp}_{client_ip}.txt'

    reader_thread = threading.Thread(
        target=client_reader, args=(client_socket, client_ip, filename))
    writer_thread = threading.Thread(
        target=client_writer, args=(client_socket, client_ip))
    reader_thread.daemon = True
    writer_thread.daemon = True
    reader_thread.start()
    writer_thread.start()

    reader_thread.join()
    writer_thread.join()

    client_alive[client_ip] = False
    try:
        client_socket.close()
    except Exception:
        pass


def client_reader(client_socket, ip, filename):
    buffer = b''
    data_index = 0
    try:
        while True:
            try:
                chunk = client_socket.recv(65535)
                if not chunk:
                    app.logger.info(f"Client {ip} disconnected")
                    break
                buffer += chunk
                while b'\n' in buffer:
                    line, buffer = buffer.split(b'\n', 1)
                    data_index += 1
                    if not line:
                        continue
                    try:
                        data = json.loads(line.decode('utf-8'))
                    except json.JSONDecodeError:
                        app.logger.warning(f"Invalid JSON from {ip}: {line}")
                        continue

                    if 'type' not in data:
                        app.logger.warning(f"Message without type from {ip}: {data}")
                        continue

                    msg_type = data['type']
                    client_last_seen[ip] = datetime.now()

                    if msg_type == 'stats':
                        handle_stats_message(ip, data, filename, data_index)
                    elif msg_type == 'heartbeat':
                        app.logger.debug(f"Heartbeat from {ip}")
                    elif msg_type == 'process_list':
                        client_has_process_list[ip] = True
                        client_last_process_list[ip] = data
                        socketio.emit(f'process_list/{ip}', data, namespace='/')
                    elif msg_type == 'filter_ack':
                        requested_count = len(client_filter_pids.get(ip, []))
                        socketio.emit(f'filter_status/{ip}', {
                            'matched_count': data.get('matched_count', 0),
                            'requested_count': requested_count,
                        }, namespace='/')
                    else:
                        app.logger.warning(f"Unknown message type from {ip}: {msg_type}")
            except socket.timeout:
                app.logger.warning(f"Connection from {ip} timed out")
                break
    except Exception as e:
        app.logger.error(f"Reader error for {ip}: {e}")
    finally:
        client_alive[ip] = False
        try:
            client_socket.close()
        except Exception:
            pass


def handle_stats_message(ip, data, filename, data_index):
    json_str = json.dumps(data) + '\n'
    client_data[ip].append(json_str)
    if len(client_data[ip]) > 1000:
        client_data[ip] = client_data[ip][-1000:]
    app.logger.info(f"Received stats from {ip}: {data_index}")

    write_data_to_file(filename, json_str)
    try:
        socketio.emit('new_ip', {'ip': ip}, namespace='/')
        count, last_time = client_subscribed[ip]
        if count > 0 and last_time and (datetime.now() - last_time).total_seconds() < 180:
            client_subscribed[ip] = (count - 1, last_time)
            socketio.emit(f'new_data/{ip}', {
                'data': json_str,
                'sequence': client_data_sequence[ip],
                'index': data_index,
            }, namespace='/')
        else:
            app.logger.info(f"Client {ip} not subscribed or timeout")
    except Exception as e:
        app.logger.error(f"WebSocket emit error: {e}")


def client_writer(client_socket, ip):
    heartbeat_interval = 30
    next_heartbeat = time.time() + heartbeat_interval
    try:
        while client_alive.get(ip, False):
            try:
                timeout = max(0.1, min(1.0, next_heartbeat - time.time()))
                message = client_outbound[ip].get(timeout=timeout)
                if message is None:
                    break
                client_socket.sendall(message.encode('utf-8'))
                continue
            except queue.Empty:
                pass
            except KeyError:
                break

            if time.time() >= next_heartbeat:
                heartbeat = json.dumps({
                    "type": "heartbeat",
                    "timestamp": int(time.time() * 1000)
                }) + "\n"
                try:
                    client_socket.sendall(heartbeat.encode('utf-8'))
                except Exception as e:
                    app.logger.error(f"Failed to send heartbeat to {ip}: {e}")
                    break
                next_heartbeat = time.time() + heartbeat_interval
    except Exception as e:
        app.logger.error(f"Writer error for {ip}: {e}")
    finally:
        client_alive[ip] = False
        try:
            client_socket.close()
        except Exception:
            pass


def write_data_to_file(filename, data):
    if not os.path.exists('log'):
        os.makedirs('log')
    with open(filename, 'a') as f:
        f.write(data)


def start_raw_socket_server():
    server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server_socket.bind(('0.0.0.0', 8001))
    server_socket.listen(5)
    app.logger.info("Raw socket server listening on 0.0.0.0:8001")
    if server_socket is None:
        app.logger.error("Failed to create socket")
        return

    while True:
        client_socket, addr = server_socket.accept()
        app.logger.info(f"Accepted connection from {addr}")
        client_thread = threading.Thread(
            target=handle_client, args=(client_socket, addr))
        client_thread.daemon = True
        client_thread.start()


def run_socket_server():
    socket_thread = threading.Thread(target=start_raw_socket_server)
    socket_thread.daemon = True
    socket_thread.start()


@app.route('/', methods=['GET'])
def index():
    args = request.args
    if 'ip' not in args or args['ip'] not in client_data:
        return render_template('index.html', client_ips=client_data.keys(), client_alive=client_alive)
    return render_template('plot.html', ip=args['ip'])


def request_process_list_from_client(ip):
    if ip not in client_outbound:
        return
    client_outbound[ip].put(json.dumps({"type": "request_process_list"}) + "\n")
    app.logger.info(f"Requested process list from {ip}")


@socketio.on('subscribe')
def handle_subscribe(message):
    ip = message['ip']
    if ip not in client_data:
        return
    client_subscribed[ip] = (10, datetime.now())
    if client_has_process_list.get(ip, False) and client_last_process_list.get(ip):
        socketio.emit(f'process_list/{ip}', client_last_process_list[ip], namespace='/')
    else:
        request_process_list_from_client(ip)


@socketio.on('request_process_list')
def handle_request_process_list(message):
    ip = message.get('ip')
    if ip is None:
        return
    request_process_list_from_client(ip)


@socketio.on('apply_filter')
def handle_apply_filter(message):
    ip = message.get('ip')
    pids = message.get('pids', [])
    if ip is None:
        return
    client_filter_pids[ip] = pids
    if ip in client_outbound:
        client_outbound[ip].put(json.dumps({"type": "filter", "patterns": [], "pids": pids}) + "\n")
        app.logger.info(f"Sent filter to {ip}: {pids}")


@socketio.on('clear_data')
def handle_clear_data(message):
    ip = message.get('ip')
    if ip is None or ip not in client_data:
        return
    client_data[ip] = []
    client_subscribed[ip] = (10, datetime.now())
    socketio.emit(f'clear/{ip}', {}, namespace='/')
    app.logger.info(f"Cleared data for {ip}")


def main():
    parser = argparse.ArgumentParser(
        prog="plotop",
        description="Real-time performance plotting server"
    )
    parser.add_argument(
        "-v", "--version",
        action="version",
        version=f"%(prog)s {__version__}"
    )
    parser.parse_args()

    run_socket_server()
    app.logger.info("Web server starting on http://127.0.0.1:5000")
    # 禁用开发服务器的警告日志
    socketio.run(app, host='127.0.0.1', port=5000,
                 use_reloader=False, log_output=False, allow_unsafe_werkzeug=True)


if __name__ == "__main__":
    main()
