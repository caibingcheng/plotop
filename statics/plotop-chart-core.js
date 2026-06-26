// plotop-chart-core.js
// Shared chart rendering utilities for Plotop.
// This file contains the core chart logic used by both the live plot page
// and exported offline HTML snapshots.

function getStepSize(duration) {
    if (duration <= 10) return 1; // 10s -> 1s
    if (duration <= 30) return 5; // 30s -> 5s
    if (duration <= 60) return 10; // 1min -> 10s
    if (duration <= 180) return 30; // 3min -> 30s
    if (duration <= 300) return 30; // 5min -> 30s
    if (duration <= 1800) return 180; // 30min -> 3min
    if (duration <= 3600) return 600; // 1H -> 10min
    if (duration <= 7200) return 1200; // 2H -> 20min
    if (duration <= 43200) return 3600; // 12H -> 1H
    return 7200; // 24H -> 2H
}

function getCommonXAxisConfig(duration) {
    return {
        type: 'linear',
        ticks: {
            stepSize: getStepSize(duration),
            callback: function (value) {
                return value + 's'; // 显示秒数并添加单位
            },
            autoSkip: false // 禁用自动跳过
        },
        grid: {
            drawTicks: true, // 保留每个 tick 的线
            drawOnChartArea: true, // 绘制网格线
            drawBorder: true // 绘制边框线
        },
        min: 0,
        max: duration
    };
}

function getCommonChartConfig(title, duration) {
    return {
        type: 'line',
        data: {
            labels: [], // 时间戳
            datasets: [] // 初始化时不包含任何数据集
        },
        options: {
            responsive: true,
            animation: false,
            elements: {
                point: {
                    radius: 1 // 数据点的圆圈半径
                },
                line: {
                    tension: 0.4 // 设置线条的平滑度，0 为直线，1 为完全平滑
                }
            },
            plugins: {
                legend: {
                    display: false // 隐藏默认图例，使用 statistics table 进行线条选择
                }
            },
            scales: {
                x: getCommonXAxisConfig(duration),
                y: {
                    title: {
                        display: true,
                        text: title
                    }
                }
            }
        }
    };
}

function calculateStatistics(data) {
    const filtered_data = data.filter(item => item !== null && !isNaN(item));
    if (filtered_data.length === 0) return { avg: 0, min: 0, max: 0, stdDev: 0 };

    const sum = filtered_data.reduce((acc, val) => acc + val, 0);
    const avg = sum / filtered_data.length;
    const min = Math.min(...filtered_data);
    const max = Math.max(...filtered_data);
    const variance = filtered_data.reduce((acc, val) => acc + Math.pow(val - avg, 2), 0) / filtered_data.length;
    const stdDev = Math.sqrt(variance);

    return { avg, min, max, stdDev };
}

function updateStatistics(chart, stats_container_id, flash = false) {
    const datasets = chart.data.datasets;
    const stats_container = document.getElementById(stats_container_id);

    if (!stats_container) return;

    let stats_data = datasets.map(dataset => {
        const data = dataset.data;
        const stats = calculateStatistics(data);
        return {
            metric: dataset.label,
            avg: stats.avg.toFixed(2),
            min: stats.min.toFixed(2),
            max: stats.max.toFixed(2),
            stdDev: stats.stdDev.toFixed(2),
            color: dataset.borderColor,
            hidden: !!dataset.hidden
        };
    });

    // 保留上一次的排序规则
    let sortColumn = stats_container.dataset.sortColumn || 'metric';
    let sortOrder = stats_container.dataset.sortOrder || 'asc';

    function renderTable() {
        const sortedData = [...stats_data].sort((a, b) => {
            const a_list = String(a[sortColumn]).split(' ');
            const b_list = String(b[sortColumn]).split(' ');
            const a_values = a_list.map(item => isNaN(parseFloat(item)) ? item : parseFloat(item));
            const b_values = b_list.map(item => isNaN(parseFloat(item)) ? item : parseFloat(item));

            if (sortOrder === 'asc') {
                for (let i = 0; i < a_values.length; i++) {
                    if (a_values[i] < b_values[i]) return -1;
                    if (a_values[i] > b_values[i]) return 1;
                }
                return 0;
            } else {
                for (let i = 0; i < a_values.length; i++) {
                    if (a_values[i] > b_values[i]) return -1;
                    if (a_values[i] < b_values[i]) return 1;
                }
                return 0;
            }
        });

        let stats_html = `
            <table border="1" style="border-collapse: collapse; width: 100%; text-align: left;">
                <thead>
                    <tr>
                        <th data-column="metric">Metric</th>
                        <th data-column="avg">Avg</th>
                        <th data-column="min">Min</th>
                        <th data-column="max">Max</th>
                        <th data-column="stdDev">StdDev</th>
                    </tr>
                </thead>
                <tbody>
        `;

        sortedData.forEach(row => {
            const existingRow = stats_container.querySelector(`tr[data-metric="${row.metric}"]`);
            const isUpdated = flash && (!existingRow ||
                existingRow.getAttribute('data-avg') !== row.avg ||
                existingRow.getAttribute('data-min') !== row.min ||
                existingRow.getAttribute('data-max') !== row.max ||
                existingRow.getAttribute('data-stdDev') !== row.stdDev);

            // 实时读取 dataset 的 hidden 状态，确保点击后表格立即刷新
            const dataset = datasets.find(d => d.label === row.metric);
            const isHidden = dataset ? !!dataset.hidden : row.hidden;

            stats_html += `
                <tr class="${isUpdated ? 'updated-row' : ''} ${isHidden ? 'metric-hidden' : ''}"
                    data-metric="${row.metric}"
                    data-avg="${row.avg}"
                    data-min="${row.min}"
                    data-max="${row.max}"
                    data-stdDev="${row.stdDev}"
                    title="点击隐藏/显示该线条">
                    <td><span class="color-dot" style="background-color: ${row.color};"></span>${row.metric}</td>
                    <td>${row.avg}</td>
                    <td>${row.min}</td>
                    <td>${row.max}</td>
                    <td>${row.stdDev}</td>
                </tr>
            `;
        });

        stats_html += `
                </tbody>
            </table>
        `;

        stats_container.innerHTML = stats_html;

        // 添加表头排序事件监听器
        const headers = stats_container.querySelectorAll('th');
        headers.forEach(header => {
            header.addEventListener('click', function () {
                const column = this.getAttribute('data-column');
                if (sortColumn === column) {
                    sortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
                } else {
                    sortColumn = column;
                    sortOrder = 'asc';
                }
                stats_container.dataset.sortColumn = sortColumn;
                stats_container.dataset.sortOrder = sortOrder;
                renderTable();
            });
        });

        // 添加行点击事件监听器，用于切换线条显示/隐藏
        const rows = stats_container.querySelectorAll('tbody tr');
        rows.forEach(row => {
            row.addEventListener('click', function () {
                const metric = this.getAttribute('data-metric');
                const dataset = datasets.find(d => d.label === metric);
                if (dataset) {
                    dataset.hidden = !dataset.hidden;
                    chart.update();
                    renderTable();
                }
            });
        });
    }

    renderTable();
}

function getMetricsValue() {
    const pidMetrics = Array.from(selectedPids).map(pid => `pid=${pid}`);
    return [...selectedSystemMetrics, ...pidMetrics].join(',');
}

function addChart(name, y_axis_label, is_system_chart = false, chart_title = null) {
    const wrapper = document.createElement('div');
    wrapper.className = 'chart-wrapper';
    wrapper.id = 'chart-wrapper-' + name.replace(/[^a-zA-Z0-9]/g, '_');

    const title = document.createElement('div');
    title.className = 'chart-title';
    title.textContent = chart_title || y_axis_label;

    var ctx = document.createElement('canvas');
    const random_id = Math.random().toString(36).substring(2, 15);
    ctx.id = name.replace(' ', '_') + random_id;
    ctx.style.width = '100%';
    ctx.style.height = 'calc(100vh / 3)';

    const stats_container = document.createElement('div');
    stats_container.id = `${ctx.id}_stats`;
    stats_container.style.fontSize = '14px';

    wrapper.appendChild(title);
    wrapper.appendChild(ctx);
    wrapper.appendChild(stats_container);

    let content = document.getElementById("content");
    const first_wrapper = document.querySelector('.chart-wrapper');
    if (is_system_chart && first_wrapper) {
        content.insertBefore(wrapper, first_wrapper);
    } else {
        content.appendChild(wrapper);
    }

    var chart = new Chart(ctx, getCommonChartConfig(y_axis_label, data_storage.duration));
    return [chart, ctx, stats_container.id];
}

function updateAllStatistics() {
    if (system_charts['system_cores']) {
        updateStatistics(system_charts['system_cores'].chart, system_charts['system_cores'].stats_id);
    }
    if (system_charts['system_cpu']) {
        updateStatistics(system_charts['system_cpu'].chart, system_charts['system_cpu'].stats_id);
    }
    if (system_charts['system_memory']) {
        updateStatistics(system_charts['system_memory'].chart, system_charts['system_memory'].stats_id);
    }
    for (const pid in process_charts) {
        const process_chart = process_charts[pid];
        if (process_chart) {
            updateStatistics(process_chart.memory, process_chart.memory_stats_id);
            updateStatistics(process_chart.cpu, process_chart.cpu_stats_id);
            updateStatistics(process_chart.thread_cpu, process_chart.thread_cpu_stats_id);
        }
    }
}

function updateChartData(chart, extended_data, x_axis_labels, filter = null) {
    chart.data.labels = x_axis_labels;
    chart.data.datasets.forEach(dataset => {
        dataset.data = extended_data.map(item => {
            if (filter) {
                return filter(dataset, item);
            }
            return item[dataset.label.toLowerCase().replace(' ', '_')];
        });
    });
    chart.update();
}

function updateAllCharts(extended_data, x_axis_labels) {
    // 更新系统内存图表
    if (system_charts['system_memory']) {
        updateChartData(system_charts['system_memory'].chart, extended_data, x_axis_labels);
    }

    // 更新系统 CPU 图表
    if (system_charts['system_cpu']) {
        updateChartData(system_charts['system_cpu'].chart, extended_data, x_axis_labels);
    }

    // 更新系统核图表
    if (system_charts['system_cores']) {
        const system_cores = system_charts['system_cores'].chart;
        system_cores.data.datasets.forEach(dataset => {
            const core_index = parseInt(dataset.label.split(' ')[1], 10);
            dataset.data = extended_data.map(item => {
                const core_data = item.cpu_cores.find(core => core.core === core_index);
                return core_data ? core_data.cpu_usage : null;
            });
        });
        system_cores.data.labels = x_axis_labels;
        system_cores.update();
    }

    // 更新进程图表
    for (const pid in process_charts) {
        const process_chart = process_charts[pid];
        if (process_chart) {
            updateChartData(process_chart.memory, extended_data, x_axis_labels, (datasets, item) => item.processes.find(p => p.pid == pid)?.memory);
            updateChartData(process_chart.cpu, extended_data, x_axis_labels, (datasets, item) => item.processes.find(p => p.pid == pid)?.cpu_usage);
            updateChartData(process_chart.thread_cpu, extended_data, x_axis_labels, (datasets, item) => {
                const thread = datasets.label.split(' ')[1];
                const process = item.processes.find(p => p.pid == pid);
                const thread_data = process ? process.threads.find(t => t.tid == thread) : null;
                return thread_data ? thread_data.cpu_usage : null;
            });
            const process_exist = extended_data[extended_data.length - 1].processes.some(p => p.pid == pid);
            if (!process_exist) {
                updateChart();
            }
        }
    }
}

function updateChart() {
    const metrics = getMetricsValue().split(/[\n,]+/).map(metric => metric.trim()).filter(metric => metric);

    initSystemCharts(metrics);
    initProcessCharts(metrics);

    // 更新统计数据
    updateAllStatistics();

    // 图表结构变化后刷新跳转菜单
    refreshJumpMenu();
}

function refreshJumpMenu() {
    const list = document.getElementById('jumpMenuList');
    const toggle = document.getElementById('jumpMenuToggle');
    if (!list || !toggle) return;

    const wrappers = document.querySelectorAll('.chart-wrapper');
    let html = '';
    wrappers.forEach(wrapper => {
        const title = wrapper.querySelector('.chart-title');
        if (title) {
            html += `<div class="jump-menu-item" data-target="${wrapper.id}">${title.textContent}</div>`;
        }
    });
    list.innerHTML = html;

    const items = list.querySelectorAll('.jump-menu-item');
    items.forEach(item => {
        item.addEventListener('click', function () {
            const targetId = this.getAttribute('data-target');
            const target = document.getElementById(targetId);
            if (target) {
                // 留出顶部 config 栏的偏移，避免 title 被遮挡
                const offset = 70;
                const top = target.getBoundingClientRect().top + window.pageYOffset - offset;
                window.scrollTo({ top: top, behavior: 'smooth' });
            }
            list.style.display = 'none';
            document.getElementById('jumpMenu').classList.remove('expanded');
        });
    });

    // 绑定展开/折叠按钮事件（只绑定一次）
    if (!toggle.dataset.bound) {
        const menu = document.getElementById('jumpMenu');
        toggle.addEventListener('click', function (event) {
            event.stopPropagation();
            if (list.style.display === 'none' || !list.style.display) {
                refreshJumpMenu();
                list.style.display = 'block';
                menu.classList.add('expanded');
            } else {
                list.style.display = 'none';
                menu.classList.remove('expanded');
            }
        });

        // 点击菜单外部区域折叠菜单
        document.addEventListener('click', function (event) {
            if (menu.contains(event.target)) return;
            if (list.style.display === 'block') {
                list.style.display = 'none';
                menu.classList.remove('expanded');
            }
        });

        toggle.dataset.bound = 'true';
    }
}

function initSystemCharts(metrics) {
    const system_memory_metrics = ["free_memory", "used_memory", "total_memory"];
    const system_cpu_metrics = ["cpu_usage", "cpu_idle"];
    const system_cores_metrics = ["cpu_cores"];

    // 检查是否需要创建或移除系统核图表
    let need_update_system_cores = false;
    const has_system_cores_metrics = metrics.some(metric => system_cores_metrics.includes(metric));
    if (has_system_cores_metrics && !system_charts['system_cores']) {
        const [system_cores_chart, system_cores_ctx, stats_id] = addChart('System Cores', 'CPU Cores(%)', true);
        system_charts['system_cores'] = {
            chart: system_cores_chart,
            ctx: system_cores_ctx,
            stats_id: stats_id
        };
        need_update_system_cores = true;
    } else if (!has_system_cores_metrics && system_charts['system_cores']) {
        const system_cores = system_charts['system_cores'].chart;
        system_cores.destroy();
        const system_cores_ctx = system_charts['system_cores'].ctx;
        if (system_cores_ctx && system_cores_ctx.parentNode && system_cores_ctx.parentNode.parentNode) {
            system_cores_ctx.parentNode.parentNode.removeChild(system_cores_ctx.parentNode);
        }

        delete system_charts['system_cores'];
        need_update_system_cores = false;
    }

    // 检查是否需要创建或移除系统 CPU 图表
    let need_update_system_cpu = false;
    const has_system_cpu_metrics = metrics.some(metric => system_cpu_metrics.includes(metric));
    if (has_system_cpu_metrics && !system_charts['system_cpu']) {
        const [system_cpu_chart, system_cpu_ctx, stats_id] = addChart('System CPU', 'CPU(%)', true);
        system_charts['system_cpu'] = {
            chart: system_cpu_chart,
            ctx: system_cpu_ctx,
            stats_id: stats_id
        };
        need_update_system_cpu = true;
    } else if (!has_system_cpu_metrics && system_charts['system_cpu']) {
        const system_cpu = system_charts['system_cpu'].chart;
        system_cpu.destroy();
        const system_cpu_ctx = system_charts['system_cpu'].ctx;
        if (system_cpu_ctx && system_cpu_ctx.parentNode && system_cpu_ctx.parentNode.parentNode) {
            system_cpu_ctx.parentNode.parentNode.removeChild(system_cpu_ctx.parentNode);
        }

        delete system_charts['system_cpu'];
        need_update_system_cpu = false;
    }

    // 检查是否需要创建或移除系统内存图表
    let need_update_system_memory = false;
    const has_system_memory_metrics = metrics.some(metric => system_memory_metrics.includes(metric));
    if (has_system_memory_metrics && !system_charts['system_memory']) {
        const [system_memory_chart, system_memory_ctx, stats_id] = addChart('System Memory', 'Memory(MB)', true);
        system_charts['system_memory'] = {
            chart: system_memory_chart,
            ctx: system_memory_ctx,
            stats_id: stats_id
        };
        need_update_system_memory = true;
    } else if (!has_system_memory_metrics && system_charts['system_memory']) {
        const system_memory = system_charts['system_memory'].chart;
        system_memory.destroy();
        const system_memory_ctx = system_charts['system_memory'].ctx;
        if (system_memory_ctx && system_memory_ctx.parentNode && system_memory_ctx.parentNode.parentNode) {
            system_memory_ctx.parentNode.parentNode.removeChild(system_memory_ctx.parentNode);
        }

        delete system_charts['system_memory'];
        need_update_system_memory = false;
    }

    // 更新系统内存图表数据
    if (system_charts['system_memory'] && need_update_system_memory) {
        const system_memory = system_charts['system_memory'].chart;
        system_memory.data.datasets = [];
        const now = data_storage.last() ? data_storage.last().timestamp : Date.now();
        const filtered_data = data_storage.data.filter(item => (now - item.timestamp) / 1000 <= data_storage.duration);

        // 多显示一个数据点
        const extended_data = [...filtered_data];
        if (filtered_data.length > 0) {
            const first_data_point = filtered_data[0];
            extended_data.unshift({
                ...first_data_point,
                timestamp: first_data_point.timestamp - 1000 // 假设间隔为 1 秒
            });
        }

        const x_axis_labels = extended_data.map(item => (item.timestamp - now) / 1000 + data_storage.duration);

        for (const metric of system_memory_metrics) {
            if (metrics.includes(metric)) {
                const label = metric.replace('_', ' ').toUpperCase();
                system_memory.data.datasets.push({
                    label: label,
                    data: extended_data.map(item => item[metric]),
                    borderColor: getColorForLabel(label),
                    backgroundColor: 'rgba(0, 0, 0, 0)',
                    borderWidth: 1,
                    fill: false
                });
            }
        }
        system_memory.data.labels = x_axis_labels;
        system_memory.update();
    }

    // 更新系统 CPU 图表数据
    if (system_charts['system_cpu'] && need_update_system_cpu) {
        const system_cpu = system_charts['system_cpu'].chart;
        system_cpu.data.datasets = [];
        const now = data_storage.last() ? data_storage.last().timestamp : Date.now();
        const filtered_data = data_storage.data.filter(item => (now - item.timestamp) / 1000 <= data_storage.duration);

        // 多显示一个数据点
        const extended_data = [...filtered_data];
        if (filtered_data.length > 0) {
            const first_data_point = filtered_data[0];
            extended_data.unshift({
                ...first_data_point,
                timestamp: first_data_point.timestamp - 1000 // 假设间隔为 1 秒
            });
        }

        const x_axis_labels = extended_data.map(item => (item.timestamp - now) / 1000 + data_storage.duration);

        for (const metric of system_cpu_metrics) {
            if (metrics.includes(metric)) {
                const label = metric.replace('_', ' ').toUpperCase();
                system_cpu.data.datasets.push({
                    label: label,
                    data: extended_data.map(item => item[metric]),
                    borderColor: getColorForLabel(label),
                    backgroundColor: 'rgba(0, 0, 0, 0)',
                    borderWidth: 1,
                    fill: false
                });
            }
        }
        system_cpu.data.labels = x_axis_labels;
        system_cpu.update();
    }

    // 更新系统核图表数据
    if (system_charts['system_cores'] && need_update_system_cores) {
        const system_cores = system_charts['system_cores'].chart;
        system_cores.data.datasets = [];
        const now = data_storage.last() ? data_storage.last().timestamp : Date.now();
        const filtered_data = data_storage.data.filter(item => (now - item.timestamp) / 1000 <= data_storage.duration);

        // 多显示一个数据点
        const extended_data = [...filtered_data];
        if (filtered_data.length > 0) {
            const first_data_point = filtered_data[0];
            extended_data.unshift({
                ...first_data_point,
                timestamp: first_data_point.timestamp - 1000 // 假设间隔为 1 秒
            });
        }

        const x_axis_labels = extended_data.map(item => (item.timestamp - now) / 1000 + data_storage.duration);

        extended_data.forEach(item => {
            item.cpu_cores.forEach(core => {
                const core_label = `Core ${core.core}`;
                if (!system_cores.data.datasets.some(dataset => dataset.label === core_label)) {
                    system_cores.data.datasets.push({
                        label: core_label,
                        data: [],
                        borderColor: getColorForLabel(core_label),
                        backgroundColor: 'rgba(0, 0, 0, 0)',
                        borderWidth: 1,
                        fill: false
                    });
                }
            });
        });

        system_cores.data.datasets.forEach(dataset => {
            const core_index = parseInt(dataset.label.split(' ')[1], 10);
            dataset.data = extended_data.map(item => {
                const core_data = item.cpu_cores.find(core => core.core === core_index);
                return core_data ? core_data.cpu_usage : null;
            });
        });

        system_cores.data.labels = x_axis_labels;
        system_cores.update();
    }
}

function initProcessCharts(metrics) {
    const pids = metrics.filter(metric => metric.startsWith('pid='));
    const comms = metrics.filter(metric => metric.startsWith('comm='));
    const process_list = pids.concat(comms);
    console.log('process_list:', process_list);
    let valid_pids = [];
    for (const process_input of process_list) {
        const pid_input = process_input.startsWith('pid=') ? process_input : null;
        const comm_input = process_input.startsWith('comm=') ? process_input : null;

        const pid = pid_input ? parseInt(pid_input.split('=')[1], 10) : null;
        const comm = comm_input ? comm_input.split('=')[1] : null;
        console.log('pid:', pid, 'comm:', comm);
        if (!pid && !comm) continue;

        const process = data_storage.last()?.processes.find(proc => ((proc.pid === pid) || proc.name.includes(comm)));
        if (!process) continue;

        const process_id = process.pid;
        const process_name = process.name;
        console.log('process_id:', process_id, 'process_name:', process_name);
        valid_pids.push(process_id);

        if (!process_charts[process_id]) {
            const process_display = `${process_name} (pid=${process_id})`;
            const memory_title = `[${process_display}] Memory(MB)`;
            const [process_memory_chart, process_memory_ctx, memory_stats_id] = addChart(`Process_${process_id}_Memory`, 'Memory(MB)', false, memory_title);
            const process_memory_label = `${process_display} Memory`;
            process_memory_chart.data.datasets.push({
                label: process_memory_label,
                data: data_storage.data.map(item => {
                    const proc = item.processes.find(p => p.pid === process_id);
                    return proc ? proc.memory : null; // 确保数据为 null 而非 0
                }),
                borderColor: getColorForLabel(process_memory_label),
                backgroundColor: 'rgba(0, 0, 0, 0)',
                borderWidth: 1,
                fill: false
            });
            process_memory_chart.update();

            const cpu_title = `[${process_display}] CPU Usage (%)`;
            const [process_cpu_chart, process_cpu_ctx, cpu_stats_id] = addChart(`Process_${process_id}_CPU`, 'CPU Usage (%)', false, cpu_title);
            const process_cpu_label = `${process_display} CPU`;
            process_cpu_chart.data.datasets.push({
                label: process_cpu_label,
                data: data_storage.data.map(item => {
                    const proc = item.processes.find(p => p.pid === process_id);
                    return proc ? proc.cpu_usage : null; // 确保数据为 null 而非 0
                }),
                borderColor: getColorForLabel(process_cpu_label),
                backgroundColor: 'rgba(0, 0, 0, 0)',
                borderWidth: 1,
                fill: false
            });
            process_cpu_chart.update();

            const thread_cpu_title = `[${process_display}] Thread CPU Usage (%)`;
            const [process_thread_cpu_chart, process_thread_cpu_ctx, thread_cpu_stats_id] = addChart(`Process_${process_id}_ThreadsCPU`, 'Thread CPU Usage (%)', false, thread_cpu_title);
            process.threads.forEach(thread => {
                const thread_label = `Thread[${thread.priority}] ${thread.tid}`;
                process_thread_cpu_chart.data.datasets.push({
                    label: thread_label,
                    data: data_storage.data.map(item => {
                        const proc = item.processes.find(p => p.pid === process_id);
                        if (proc) {
                            const thread_data = proc.threads.find(t => t.tid == thread.tid); // 使用 tid 确认线程
                            return thread_data ? thread_data.cpu_usage : null; // 确保数据为 null 而非 0
                        }
                        return null;
                    }),
                    borderColor: getColorForLabel(thread_label),
                    backgroundColor: 'rgba(0, 0, 0, 0)',
                    borderWidth: 1,
                    fill: false
                });
            });
            process_thread_cpu_chart.update();

            process_charts[process_id] = {
                memory: process_memory_chart,
                memory_ctx: process_memory_ctx,
                memory_stats_id: memory_stats_id,
                cpu: process_cpu_chart,
                cpu_ctx: process_cpu_ctx,
                cpu_stats_id: cpu_stats_id,
                thread_cpu: process_thread_cpu_chart,
                thread_cpu_ctx: process_thread_cpu_ctx,
                thread_cpu_stats_id: thread_cpu_stats_id
            };
        }
    }

    // 移除未指定的进程图表
    for (const pid in process_charts) {
        if (!valid_pids.some(p => p == pid)) {
            const process_chart = process_charts[pid];
            if (process_chart) {
                process_chart.memory.destroy();
                process_chart.cpu.destroy();
                process_chart.thread_cpu.destroy();
                delete process_charts[pid];

                const process_memory_ctx = process_chart.memory_ctx;
                const process_cpu_ctx = process_chart.cpu_ctx;
                const process_thread_cpu_ctx = process_chart.thread_cpu_ctx;
                if (process_memory_ctx && process_memory_ctx.parentNode && process_memory_ctx.parentNode.parentNode) {
                    process_memory_ctx.parentNode.parentNode.removeChild(process_memory_ctx.parentNode);
                }
                if (process_cpu_ctx && process_cpu_ctx.parentNode && process_cpu_ctx.parentNode.parentNode) {
                    process_cpu_ctx.parentNode.parentNode.removeChild(process_cpu_ctx.parentNode);
                }
                if (process_thread_cpu_ctx && process_thread_cpu_ctx.parentNode && process_thread_cpu_ctx.parentNode.parentNode) {
                    process_thread_cpu_ctx.parentNode.parentNode.removeChild(process_thread_cpu_ctx.parentNode);
                }
            }
        }
    }
}

// 随机颜色生成函数
function getRandomColor() {
    const r = Math.floor(Math.random() * 255);
    const g = Math.floor(Math.random() * 255);
    const b = Math.floor(Math.random() * 255);
    return `rgba(${r}, ${g}, ${b}, 1)`;
}

// 根据 label 生成确定性颜色，保证同一 metric 刷新后颜色一致
// 使用预定义调色板，避免相似 label 生成过于接近的颜色
function getColorForLabel(label) {
    const palette = [
        '#e6194B', '#3cb44b', '#ffe119', '#4363d8', '#f58231',
        '#911eb4', '#42d4f4', '#f032e6', '#bfef45', '#fabed4',
        '#469990', '#dcbeff', '#9A6324', '#fffac8', '#800000',
        '#aaffc3', '#808000', '#ffd8b1', '#000075', '#a9a9a9'
    ];
    let hash = 0;
    for (let i = 0; i < label.length; i++) {
        hash = ((hash << 5) - hash) + label.charCodeAt(i);
        hash |= 0;
    }
    const index = Math.abs(hash) % palette.length;
    return palette[index];
}
