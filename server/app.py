from flask import Flask, request, jsonify, render_template
from flask_socketio import SocketIO, emit
import json
import socket
import threading
import time
import os
from datetime import datetime

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*",
                    ping_interval=1, ping_timeout=5, async_mode="threading")

client_subscribed = {}
client_alive = {}
client_data = {}
client_data_sequence = {}


def handle_client(client_socket, addr):
    client_socket.settimeout(1800)
    client_ip = addr[0]

    if client_ip not in client_data_sequence:
        client_data_sequence[client_ip] = 0
    else:
        client_data_sequence[client_ip] += 1
    client_data[client_ip] = []
    client_alive[client_ip] = True
    if client_ip not in client_subscribed:
        client_subscribed[client_ip] = (0, None)

    socketio.emit(f'clear/{client_ip}', {})
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    filename = f'log/plotop_{timestamp}_{client_ip}.txt'
    try:
        data_index = 0
        while True:
            data = b''
            while True:
                chunk = client_socket.recv(65535)
                if not chunk:
                    app.logger.info(f"Client {addr} disconnected")
                    break
                data += chunk
                if is_complete_data(data):
                    break
            if not chunk:
                break
            if not is_valid_data(data):
                app.logger.warning(f"Invalid data from {client_ip}: {data}")
                continue

            data_index += 1
            client_data[client_ip].append(data.decode('utf-8'))
            if len(client_data[client_ip]) > 1000:
                client_data[client_ip] = client_data[client_ip][-1000:]
            app.logger.info(f"Received from {client_ip}: {data_index}")

            write_data_to_file(filename, data.decode('utf-8'))
            try:
                socketio.emit('new_ip', {'ip': client_ip}, namespace='/')
                count, last_time = client_subscribed[client_ip]
                if count > 0 and last_time and (datetime.now() - last_time).total_seconds() < 180:
                    client_subscribed[client_ip] = (count - 1, last_time)
                    socketio.emit(f'new_data/{client_ip}', {
                        'data': data.decode('utf-8'),
                        'sequence': client_data_sequence[client_ip],
                        'index': data_index,
                    }, namespace='/')
                else:
                    app.logger.info(
                        f"Client {client_ip} not subscribed or timeout")
            except Exception as e:
                app.logger.error(f"WebSocket emit error: {e}")
    except socket.timeout:
        app.logger.warning(f"Connection from {addr} timed out")
    finally:
        client_alive[client_ip] = False
        client_socket.close()


def write_data_to_file(filename, data):
    if not os.path.exists('log'):
        os.makedirs('log')
    with open(filename, 'a') as f:
        f.write(data + '\n')  # 直接写入字符串


def start_raw_socket_server():
    server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server_socket.bind(('0.0.0.0', 8001))
    server_socket.listen(5)
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


def is_complete_data(data):
    return data.endswith(b'\n')


def is_valid_data(data):
    try:
        data = data.decode('utf-8')
        json.loads(data)
        return True
    except json.JSONDecodeError:
        return False


def run_socket_server():
    socket_thread = threading.Thread(target=start_raw_socket_server)
    socket_thread.daemon = True
    socket_thread.start()


@app.route('/', methods=['GET'])
def index():
    args = request.args
    if 'ip' not in args or args['ip'] not in client_data:
        return render_template('index.html', client_ips=client_data.keys())
    return render_template('plot.html', ip=args['ip'])


@socketio.on('subscribe')
def handle_subscribe(message):
    ip = message['ip']
    if ip not in client_data:
        return
    client_subscribed[ip] = (10, datetime.now())


def main():
    run_socket_server()
    # 禁用开发服务器的警告日志
    socketio.run(app, host='127.0.0.1', port=5000,
                 use_reloader=False, log_output=False)
