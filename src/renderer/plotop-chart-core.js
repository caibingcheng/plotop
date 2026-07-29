// plotop-chart-core.js
// Shared chart rendering utilities for Plotop.
// This file contains the core chart logic used by both the live plot page
// and exported offline HTML snapshots.

const expandedGroups = {};

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
                    },
                    beginAtZero: false
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

    const stats_data = datasets.map(dataset => {
        const data = dataset.data;
        const stats = calculateStatistics(data);
        return {
            metric: dataset.label,
            avg: stats.avg.toFixed(2),
            min: stats.min.toFixed(2),
            max: stats.max.toFixed(2),
            stdDev: stats.stdDev.toFixed(2),
            color: dataset.borderColor,
            hidden: !!dataset.hidden,
            isGroup: !!dataset.isGroup,
            parentLabel: dataset.parentLabel || null
        };
    });

    let sortColumn = stats_container.dataset.sortColumn || 'metric';
    let sortOrder = stats_container.dataset.sortOrder || 'asc';

    function compareByColumn(a, b) {
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
    }

    // Build hierarchical groups: parent/standalone + children, sort groups as a whole
    const groups = [];
    const parentMap = new Map();
    stats_data.forEach(row => {
        if (row.isGroup) {
            const group = { parent: row, children: [] };
            parentMap.set(row.metric, group);
            groups.push(group);
        } else if (row.parentLabel) {
            const group = parentMap.get(row.parentLabel);
            if (group) {
                group.children.push(row);
            } else {
                groups.push({ parent: row, children: [] });
            }
        } else {
            groups.push({ parent: row, children: [] });
        }
    });

    groups.sort((a, b) => compareByColumn(a.parent, b.parent));
    groups.forEach(group => {
        group.children.sort((a, b) => compareByColumn(a, b));
    });

    const sortedData = [];
    groups.forEach(group => {
        sortedData.push(group.parent);
        group.children.forEach(child => sortedData.push(child));
    });

    let table = stats_container.querySelector('table.stats-table');
    if (!table) {
        table = document.createElement('table');
        table.className = 'stats-table';

        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        ['action', 'metric', 'avg', 'min', 'max', 'stdDev'].forEach(column => {
            const th = document.createElement('th');
            th.setAttribute('data-column', column);
            th.textContent = column === 'stdDev' ? 'StdDev' : (column === 'action' ? 'Action' : column.charAt(0).toUpperCase() + column.slice(1));
            if (column !== 'action') {
                const sortIndicator = document.createElement('span');
                sortIndicator.className = 'sort-indicator';
                th.appendChild(sortIndicator);
            }
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);

        const tbody = document.createElement('tbody');
        table.appendChild(thead);
        table.appendChild(tbody);
        stats_container.appendChild(table);

        thead.addEventListener('click', function (event) {
            const header = event.target.closest('th');
            if (!header) return;
            const column = header.getAttribute('data-column');
            if (column === 'action') return;
            if (sortColumn === column) {
                sortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
            } else {
                sortColumn = column;
                sortOrder = 'asc';
            }
            stats_container.dataset.sortColumn = sortColumn;
            stats_container.dataset.sortOrder = sortOrder;
            updateStatistics(chart, stats_container_id, false);
        });

        function updateSortIndicators() {
            thead.querySelectorAll('th').forEach(th => {
                const column = th.getAttribute('data-column');
                const indicator = th.querySelector('.sort-indicator');
                if (!indicator) return;
                th.classList.toggle('sort-active', column === sortColumn);
                if (column === sortColumn) {
                    indicator.textContent = sortOrder === 'asc' ? '▲' : '▼';
                } else {
                    indicator.textContent = '↕';
                }
            });
        }
        updateSortIndicators();

        function toggleExpand(metric) {
            expandedGroups[`${stats_container_id}:${metric}`] = !expandedGroups[`${stats_container_id}:${metric}`];
            updateStatistics(chart, stats_container_id, false);
        }

        function toggleVisibility(dataset, metric) {
            if (dataset.isGroup) {
                const newHidden = !dataset.hidden;
                dataset.hidden = newHidden;
                if (newHidden) {
                    dataset._childHiddenStates = {};
                    datasets.forEach(d => {
                        if (d.parentLabel === metric) {
                            dataset._childHiddenStates[d.label] = d.hidden;
                            d.hidden = true;
                        }
                    });
                } else {
                    datasets.forEach(d => {
                        if (d.parentLabel === metric) {
                            if (dataset._childHiddenStates && d.label in dataset._childHiddenStates) {
                                d.hidden = dataset._childHiddenStates[d.label];
                            }
                        }
                    });
                }
            } else {
                dataset.hidden = !dataset.hidden;
            }
            chart.update();
            updateStatistics(chart, stats_container_id, false);
        }

        tbody.addEventListener('click', function (event) {
            const row = event.target.closest('tr');
            if (!row) return;
            const metric = row.getAttribute('data-metric');
            const dataset = datasets.find(d => d.label === metric);
            if (!dataset) return;

            if (event.target.closest('.stats-row-expand-btn')) {
                event.stopPropagation();
                toggleExpand(metric);
                return;
            }

            if (event.target.closest('.visibility-toggle')) {
                event.stopPropagation();
                toggleVisibility(dataset, metric);
                return;
            }

            if (event.target.classList.contains('color-dot')) {
                event.stopPropagation();
                const input = document.createElement('input');
                input.type = 'color';
                input.value = colorToHex(dataset.borderColor);
                input.style.position = 'fixed';
                input.style.opacity = '0';
                input.style.pointerEvents = 'none';
                document.body.appendChild(input);

                input.addEventListener('input', function () {
                    applyColorOverride(metric, this.value);
                });
                input.addEventListener('change', function () {
                    setColorOverride(metric, this.value);
                    updateAllStatistics();
                    if (typeof saveColorOverridesForIp === 'function') saveColorOverridesForIp();
                    document.body.removeChild(input);
                });
                input.click();
                return;
            }

            if (event.target.closest('.random-color-btn')) {
                event.stopPropagation();
                randomizeColorForLabel(metric);
                return;
            }

            const hasChildren = dataset.isGroup && datasets.some(d => d.parentLabel === metric);
            if (dataset.isGroup && hasChildren) {
                toggleExpand(metric);
            } else {
                toggleVisibility(dataset, metric);
            }
        });

        tbody.addEventListener('contextmenu', function (event) {
            const row = event.target.closest('tr');
            if (!row) return;
            const metric = row.getAttribute('data-metric');
            const dataset = datasets.find(d => d.label === metric);
            if (!dataset) return;
            event.preventDefault();
            event.stopPropagation();

            const visibleCount = datasets.filter(d => !d.hidden).length;
            const isOnlyVisible = !dataset.hidden && visibleCount === 1;

            if (isOnlyVisible) {
                datasets.forEach(d => { d.hidden = false; });
            } else {
                datasets.forEach(d => { d.hidden = d.label !== metric; });
            }
            chart.update();
            updateStatistics(chart, stats_container_id, false);
        });
    }

    const thead = table.querySelector('thead');
    if (thead) {
        thead.querySelectorAll('th').forEach(th => {
            const column = th.getAttribute('data-column');
            const indicator = th.querySelector('.sort-indicator');
            if (!indicator) return;
            th.classList.toggle('sort-active', column === sortColumn);
            if (column === sortColumn) {
                indicator.textContent = sortOrder === 'asc' ? '▲' : '▼';
            } else {
                indicator.textContent = '↕';
            }
        });
    }

    const tbody = table.querySelector('tbody');
    const existingRows = Array.from(tbody.querySelectorAll('tr'));
    const rowMap = new Map();
    existingRows.forEach(row => rowMap.set(row.getAttribute('data-metric'), row));

    sortedData.forEach(row => {
        let tr = rowMap.get(row.metric);
        const isNew = !tr;
        const isChild = !!row.parentLabel;
        const isGroup = row.isGroup;

        if (isNew) {
            tr = document.createElement('tr');
            tr.setAttribute('data-metric', row.metric);
            tr.setAttribute('title', '左键单击隐藏/显示，右键单击显示一个/全部');

            const actionTd = document.createElement('td');
            actionTd.className = 'action-cell';

            if (isGroup) {
                const expandBtn = document.createElement('span');
                expandBtn.className = 'stats-row-expand-btn';
                expandBtn.title = '展开/折叠子项';
                actionTd.appendChild(expandBtn);
            }

            const visibilityBtn = document.createElement('span');
            visibilityBtn.className = 'visibility-toggle';
            visibilityBtn.title = '隐藏/显示该线条';
            actionTd.appendChild(visibilityBtn);

            const colorDot = document.createElement('span');
            colorDot.className = 'color-dot';
            colorDot.title = '点击选择颜色';
            actionTd.appendChild(colorDot);

            const randomBtn = document.createElement('span');
            randomBtn.className = 'random-color-btn';
            randomBtn.title = '随机颜色';
            randomBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 6V3L8 7l4 4V8c2.76 0 5 2.24 5 5 0 .55.45 1 1 1s1-.45 1-1c0-3.87-3.13-7-7-7zm-1 12c-2.76 0-5-2.24-5-5 0-.55-.45-1-1-1s-1 .45-1 1c0 3.87 3.13 7 7 7v3l4-4-4-4v3z"/></svg>';
            actionTd.appendChild(randomBtn);

            const metricTd = document.createElement('td');
            metricTd.className = 'metric-name';
            metricTd.textContent = row.metric;

            tr.appendChild(actionTd);
            tr.appendChild(metricTd);

            ['avg', 'min', 'max', 'stdDev'].forEach(column => {
                const td = document.createElement('td');
                td.className = 'val-' + column;
                tr.appendChild(td);
            });
        }

        if (isGroup) {
            const expanded = !!expandedGroups[`${stats_container_id}:${row.metric}`];
            tr.classList.toggle('expanded', expanded);
            const expandBtn = tr.querySelector('.stats-row-expand-btn');
            if (expandBtn) expandBtn.textContent = expanded ? '▼' : '▶';
        }

        if (isChild) {
            const expanded = !!expandedGroups[`${stats_container_id}:${row.parentLabel}`];
            tr.style.display = expanded ? '' : 'none';
        } else {
            tr.style.display = '';
        }

        const oldAvg = tr.getAttribute('data-avg');
        const oldMin = tr.getAttribute('data-min');
        const oldMax = tr.getAttribute('data-max');
        const oldStdDev = tr.getAttribute('data-stdDev');
        const isUpdated = flash && (isNew ||
            oldAvg !== row.avg ||
            oldMin !== row.min ||
            oldMax !== row.max ||
            oldStdDev !== row.stdDev);

        tr.setAttribute('data-avg', row.avg);
        tr.setAttribute('data-min', row.min);
        tr.setAttribute('data-max', row.max);
        tr.setAttribute('data-stdDev', row.stdDev);

        tr.className = `${row.hidden ? 'metric-hidden' : ''} ${isUpdated ? 'updated-row' : ''} ${isGroup ? 'stats-row-group' : ''} ${isChild ? 'stats-row-child' : ''}`.trim();

        const hasChildren = isGroup && datasets.some(d => d.parentLabel === row.metric);
        const rowTitle = (isGroup && hasChildren)
            ? '左键单击展开/折叠，右键单击显示一个/全部'
            : '左键单击隐藏/显示，右键单击显示一个/全部';
        if (tr.getAttribute('title') !== rowTitle) {
            tr.setAttribute('title', rowTitle);
        }

        const visibilityBtn = tr.querySelector('.visibility-toggle');
        if (visibilityBtn) {
            visibilityBtn.innerHTML = row.hidden
                ? '<svg viewBox="0 0 24 24"><path d="M12 6c3.79 0 7.17 2.13 8.82 5.5-.59 1.1-1.39 2.09-2.34 2.9L22 19.35 20.65 21l-2.86-2.86C16.46 19.37 14.31 20.25 12 20.25c-3.79 0-7.17-2.13-8.82-5.5.95-1.78 2.42-3.2 4.17-4.08L2.6 5.1 4 3.7l4.7 4.7C9.71 7.64 10.79 7.04 12 6.83V6m0-1.5c-1.39 0-2.72.3-3.96.83L12 10.3l3.96-3.96C14.72 4.8 13.39 4.5 12 4.5m-7.64 2.1L3.75 7.2C2.67 8.64 1.95 10.31 1.69 12.1 2.94 15.17 5.5 17.5 8.45 18.56l-2.24-2.24C4.5 15.21 2.9 13.83 4.36 6.6z"/></svg>'
                : '<svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5C21.27 7.61 17 4.5 12 4.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>';
        }

        const colorDot = tr.querySelector('.color-dot');
        if (colorDot) colorDot.style.backgroundColor = row.color;

        const setCell = (selector, value) => {
            const cell = tr.querySelector(selector);
            if (cell && cell.textContent !== value) {
                cell.textContent = value;
            }
        };
        setCell('.val-avg', row.avg);
        setCell('.val-min', row.min);
        setCell('.val-max', row.max);
        setCell('.val-stdDev', row.stdDev);

        tbody.appendChild(tr);
    });

    const currentMetrics = new Set(sortedData.map(r => r.metric));
    existingRows.forEach(row => {
        if (!currentMetrics.has(row.getAttribute('data-metric'))) {
            if (row.parentNode === tbody) {
                tbody.removeChild(row);
            }
        }
    });
}

function getMetricsValue() {
    const processMetrics = [];
    if (typeof appliedProcessSelections !== 'undefined' && appliedProcessSelections) {
        for (const sel of appliedProcessSelections.values()) {
            switch (sel.mode) {
                case 'pid': processMetrics.push(`pid=${sel.pid}`); break;
                case 'name': processMetrics.push(`name=${sel.name}`); break;
                case 'pid+name': processMetrics.push(`pid+name=${sel.pid}:${sel.name}`); break;
            }
        }
    }
    return [...selectedSystemMetrics, ...processMetrics].join(',');
}

function getSelectionKey(selection) {
    if (selection.mode === 'name') return `name:${selection.name}`;
    if (selection.mode === 'pid+name') return `pid+name:${selection.pid}:${selection.name}`;
    return `pid:${selection.pid}`;
}

function resolveCurrentPid(selection, processList) {
    if (!processList || !Array.isArray(processList)) return null;
    switch (selection.mode) {
        case 'pid':
            return selection.pid;
        case 'name': {
            const matches = processList.filter(p => p && p.name === selection.name);
            return matches.length === 1 ? matches[0].pid : null;
        }
        case 'pid+name': {
            const match = processList.find(p => p && p.pid === selection.pid && p.name === selection.name);
            return match ? match.pid : null;
        }
    }
    return null;
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
    ctx.style.height = '240px';

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
    return [chart, ctx, stats_container.id, wrapper];
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
            const parts = dataset.label.split(' ');
            const core_index = parseInt(parts[1], 10);
            const metric = parts.length > 2 ? 'cpu_' + parts[2].toLowerCase() : 'cpu_usage';
            dataset.data = extended_data.map(item => {
                const core_data = item.cpu_cores.find(core => core.core === core_index);
                return core_data ? core_data[metric] : null;
            });
        });
        system_cores.data.labels = x_axis_labels;
        system_cores.update();
    }

    // 更新进程图表
    const latest_data = extended_data[extended_data.length - 1] || null;
    for (const key in process_charts) {
        const process_chart = process_charts[key];
        if (!process_chart) continue;
        const selection = process_chart.selection;
        const live_process = selection ? findProcessForSelection(latest_data, selection) : null;
        const is_exited = !live_process;

        updateChartData(process_chart.memory, extended_data, x_axis_labels, (datasets, item) => {
            const process = findProcessForSelection(item, selection);
            return process ? process.memory : null;
        });
        updateChartData(process_chart.cpu, extended_data, x_axis_labels, (dataset, item) => {
            const process = findProcessForSelection(item, selection);
            if (!process) return null;
            const metricMap = { 'CPU Total': 'cpu_usage', 'CPU User': 'cpu_user', 'CPU System': 'cpu_system' };
            const field = metricMap[dataset.label];
            return field !== undefined ? process[field] : null;
        });

        if (live_process) {
            const currentInstanceKey = live_process.starttime ? `${live_process.pid}:${live_process.starttime}` : String(live_process.pid);
            if (process_chart.instanceKey !== undefined && process_chart.instanceKey !== currentInstanceKey) {
                process_chart.thread_cpu.data.datasets = [];
                process_chart.restartedUntil = Date.now() + 5000;
            }
            process_chart.instanceKey = currentInstanceKey;

            live_process.threads.forEach(thread => {
                const thread_label = `Thread[${thread.priority}] ${thread.tid}`;
                if (!process_chart.thread_cpu.data.datasets.some(d => d.label === thread_label)) {
                    process_chart.thread_cpu.data.datasets.push({
                        label: thread_label,
                        data: extended_data.map(item => {
                            const proc = findProcessForSelection(item, selection);
                            if (proc) {
                                const thread_data = proc.threads.find(t => t.tid === thread.tid);
                                return thread_data ? thread_data.cpu_usage : null;
                            }
                            return null;
                        }),
                        borderColor: getColorForLabel(thread_label),
                        backgroundColor: 'rgba(0, 0, 0, 0)',
                        borderWidth: 1,
                        fill: false,
                        isGroup: true
                    });
                    ['User', 'System'].forEach(childSuffix => {
                        const childLabel = `${thread_label} ${childSuffix}`;
                        const field = childSuffix === 'User' ? 'cpu_user' : 'cpu_system';
                        process_chart.thread_cpu.data.datasets.push({
                            label: childLabel,
                            data: extended_data.map(item => {
                                const proc = findProcessForSelection(item, selection);
                                if (proc) {
                                    const thread_data = proc.threads.find(t => t.tid === thread.tid);
                                    return thread_data ? thread_data[field] : null;
                                }
                                return null;
                            }),
                            borderColor: getColorForLabel(childLabel),
                            backgroundColor: 'rgba(0, 0, 0, 0)',
                            borderWidth: 1,
                            fill: false,
                            parentLabel: thread_label,
                            hidden: true
                        });
                    });
                }
            });
        }

        updateChartData(process_chart.thread_cpu, extended_data, x_axis_labels, (dataset, item) => {
            const parts = dataset.label.split(' ');
            const tid = parts[1];
            const suffix = parts[2];
            const field = suffix ? (suffix === 'User' ? 'cpu_user' : 'cpu_system') : 'cpu_usage';
            const process = findProcessForSelection(item, selection);
            const thread_data = process ? process.threads.find(t => String(t.tid) === tid) : null;
            return thread_data ? thread_data[field] : null;
        });

        function updateProcessDisplay(process_chart, displayPid, name) {
            const expected_title = `${name} (pid=${displayPid})`;
            if (process_chart.title !== expected_title) {
                process_chart.title = expected_title;
            }
        }

        const displayPid = live_process ? live_process.pid : (selection ? selection.pid : 0);
        const displayName = live_process ? live_process.name : (findProcessNameByPid(displayPid) || (selection ? selection.name : 'unknown'));
        updateProcessDisplay(process_chart, displayPid, displayName);

        const wrappers = [
            process_chart.memory_wrapper,
            process_chart.cpu_wrapper,
            process_chart.thread_cpu_wrapper
        ];
        const suffixes = [
            'Memory(MB)',
            'CPU Usage (%)',
            'Thread CPU Usage (%)'
        ];
        wrappers.forEach((wrapper, index) => {
            if (!wrapper) return;
            const title_el = wrapper.querySelector('.chart-title');
            if (!title_el) return;
            const is_restarted = index === 2 && process_chart.restartedUntil && Date.now() < process_chart.restartedUntil;
            const desired_title = `[${process_chart.title}] ${suffixes[index]}` + (is_exited ? ' [exited]' : '') + (is_restarted ? ' [restarted]' : '');
            if (title_el.textContent !== desired_title) {
                title_el.textContent = desired_title;
            }
            wrapper.classList.toggle('exited', is_exited);
        });
    }
}

function findProcessNameByPid(pid) {
    for (let i = data_storage.data.length - 1; i >= 0; i--) {
        const item = data_storage.data[i];
        const proc = item.processes.find(p => p.pid === pid);
        if (proc) return proc.name;
    }
    return null;
}

function appendChartData(chart, newItem, valueExtractor) {
    if (!chart || !chart.data || !newItem || !newItem.timestamp) return;
    const duration = data_storage.duration;
    const now = newItem.timestamp;
    if (!chart._renderTimestamps) {
        chart._renderTimestamps = [];
    }

    const timestamps = chart._renderTimestamps;
    timestamps.push(now);
    while (timestamps.length > 0 && (now - timestamps[0]) / 1000 > duration) {
        timestamps.shift();
    }

    chart.data.labels = timestamps.map(ts => (ts - now) / 1000 + duration);

    chart.data.datasets.forEach(dataset => {
        const y = valueExtractor(dataset, newItem);
        dataset.data.push(y);
        while (dataset.data.length > timestamps.length) {
            dataset.data.shift();
        }
    });

    chart.update('none');
}

function appendAllChartsData(newItem) {
    if (!newItem || !newItem.timestamp) return;
    const duration = data_storage.duration;

    if (system_charts['system_memory']) {
        appendChartData(system_charts['system_memory'].chart, newItem, (dataset, item) => {
            return item[dataset.label.toLowerCase().replace(' ', '_')];
        });
    }

    if (system_charts['system_cpu']) {
        appendChartData(system_charts['system_cpu'].chart, newItem, (dataset, item) => {
            return item[dataset.label.toLowerCase().replace(' ', '_')];
        });
    }

    if (system_charts['system_cores']) {
        appendChartData(system_charts['system_cores'].chart, newItem, (dataset, item) => {
            const parts = dataset.label.split(' ');
            const core_index = parseInt(parts[1], 10);
            const metric = parts.length > 2 ? 'cpu_' + parts[2].toLowerCase() : 'cpu_usage';
            const core_data = item.cpu_cores.find(core => core.core === core_index);
            return core_data ? core_data[metric] : null;
        });
    }

    for (const key in process_charts) {
        const process_chart = process_charts[key];
        if (!process_chart) continue;
        const selection = process_chart.selection;

        appendChartData(process_chart.memory, newItem, (dataset, item) => {
            const process = findProcessForSelection(item, selection);
            return process ? process.memory : null;
        });

        appendChartData(process_chart.cpu, newItem, (dataset, item) => {
            const process = findProcessForSelection(item, selection);
            if (!process) return null;
            const metricMap = { 'CPU Total': 'cpu_usage', 'CPU User': 'cpu_user', 'CPU System': 'cpu_system' };
            const field = metricMap[dataset.label];
            return field !== undefined ? process[field] : null;
        });

        const live_process = findProcessForSelection(newItem, selection);
        let needsThreadRebuild = false;
        if (live_process) {
            const currentInstanceKey = live_process.starttime ? `${live_process.pid}:${live_process.starttime}` : String(live_process.pid);
            if (process_chart.instanceKey !== undefined && process_chart.instanceKey !== currentInstanceKey) {
                process_chart.thread_cpu.data.datasets = [];
                process_chart.restartedUntil = Date.now() + 5000;
                needsThreadRebuild = true;
            }
            process_chart.instanceKey = currentInstanceKey;

            live_process.threads.forEach(thread => {
                const thread_label = `Thread[${thread.priority}] ${thread.tid}`;
                if (!process_chart.thread_cpu.data.datasets.some(d => d.label === thread_label)) {
                    needsThreadRebuild = true;
                }
            });
        }

        if (needsThreadRebuild) {
            const now = data_storage.last() ? data_storage.last().timestamp : Date.now();
            const filtered = data_storage.data.filter(item => (now - item.timestamp) / 1000 <= duration + 10);
            const x_axis_labels = filtered.map(item => (item.timestamp - now) / 1000 + duration);
            process_chart.thread_cpu.data.labels = x_axis_labels;
            process_chart.thread_cpu._renderTimestamps = filtered.map(item => item.timestamp);
            process_chart.thread_cpu.data.datasets = live_process.threads.flatMap(thread => {
                const thread_label = `Thread[${thread.priority}] ${thread.tid}`;
                const parent = {
                    label: thread_label,
                    data: filtered.map(item => {
                        const proc = findProcessForSelection(item, selection);
                        if (proc) {
                            const thread_data = proc.threads.find(t => t.tid === thread.tid);
                            return thread_data ? thread_data.cpu_usage : null;
                        }
                        return null;
                    }),
                    borderColor: getColorForLabel(thread_label),
                    backgroundColor: 'rgba(0, 0, 0, 0)',
                    borderWidth: 1,
                    fill: false,
                    isGroup: true
                };
                const children = ['User', 'System'].map(childSuffix => {
                    const childLabel = `${thread_label} ${childSuffix}`;
                    const field = childSuffix === 'User' ? 'cpu_user' : 'cpu_system';
                    return {
                        label: childLabel,
                        data: filtered.map(item => {
                            const proc = findProcessForSelection(item, selection);
                            if (proc) {
                                const thread_data = proc.threads.find(t => t.tid === thread.tid);
                                return thread_data ? thread_data[field] : null;
                            }
                            return null;
                        }),
                        borderColor: getColorForLabel(childLabel),
                        backgroundColor: 'rgba(0, 0, 0, 0)',
                        borderWidth: 1,
                        fill: false,
                        parentLabel: thread_label,
                        hidden: true
                    };
                });
                return [parent, ...children];
            });
            process_chart.thread_cpu.update();
        } else {
            appendChartData(process_chart.thread_cpu, newItem, (dataset, item) => {
                const parts = dataset.label.split(' ');
                const tid = parts[1];
                const suffix = parts[2];
                const field = suffix ? (suffix === 'User' ? 'cpu_user' : 'cpu_system') : 'cpu_usage';
                const process = findProcessForSelection(item, selection);
                const thread_data = process ? process.threads.find(t => String(t.tid) === tid) : null;
                return thread_data ? thread_data[field] : null;
            });
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
            html += `<div class="app-list-item" data-target="${wrapper.id}">${title.textContent}</div>`;
        }
    });
    list.innerHTML = html;

    const items = list.querySelectorAll('.app-list-item');
    items.forEach(item => {
        item.addEventListener('click', function () {
            const targetId = this.getAttribute('data-target');
            const target = document.getElementById(targetId);
            if (target) {
                // 留出顶部 toolbar 的偏移，避免 title 被遮挡
                const offset = 60;
                const top = target.getBoundingClientRect().top + window.pageYOffset - offset;
                window.scrollTo({ top: top, behavior: 'smooth' });
            }
            const menu = document.getElementById('jumpMenu');
            if (menu) {
                menu.classList.add('collapsed');
                document.body.classList.remove('has-side-nav');
            }
        });
    });

    // 绑定展开/折叠按钮事件（只绑定一次）
    if (!toggle.dataset.bound) {
        const menu = document.getElementById('jumpMenu');
        toggle.addEventListener('click', function (event) {
            event.stopPropagation();
            menu.classList.toggle('collapsed');
            document.body.classList.toggle('has-side-nav', !menu.classList.contains('collapsed'));
            if (!menu.classList.contains('collapsed')) {
                refreshJumpMenu();
            }
        });

        // 点击菜单外部区域折叠菜单
        document.addEventListener('click', function (event) {
            if (menu.contains(event.target) || toggle.contains(event.target)) return;
            if (!menu.classList.contains('collapsed')) {
                menu.classList.add('collapsed');
                document.body.classList.remove('has-side-nav');
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
                if (metric === 'cpu_usage') {
                    const label = 'CPU_USAGE';
                    system_cpu.data.datasets.push({
                        label: label,
                        data: extended_data.map(item => item.cpu_usage),
                        borderColor: getColorForLabel(label),
                        backgroundColor: 'rgba(0, 0, 0, 0)',
                        borderWidth: 1,
                        fill: false,
                        isGroup: true
                    });
                    const children = ['CPU_USER', 'CPU_SYSTEM', 'CPU_IOWAIT', 'CPU_IRQ', 'CPU_SOFTIRQ'];
                    children.forEach(child => {
                        system_cpu.data.datasets.push({
                            label: child,
                            data: extended_data.map(item => item[child.toLowerCase()]),
                            borderColor: getColorForLabel(child),
                            backgroundColor: 'rgba(0, 0, 0, 0)',
                            borderWidth: 1,
                            fill: false,
                            parentLabel: label,
                            hidden: true
                        });
                    });
                } else {
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
                        fill: false,
                        isGroup: true
                    });
                    ['User', 'System'].forEach(childSuffix => {
                        const childLabel = `${core_label} ${childSuffix}`;
                        system_cores.data.datasets.push({
                            label: childLabel,
                            data: [],
                            borderColor: getColorForLabel(childLabel),
                            backgroundColor: 'rgba(0, 0, 0, 0)',
                            borderWidth: 1,
                            fill: false,
                            parentLabel: core_label,
                            hidden: true
                        });
                    });
                }
            });
        });

        system_cores.data.datasets.forEach(dataset => {
            const parts = dataset.label.split(' ');
            const core_index = parseInt(parts[1], 10);
            const metric = parts.length > 2 ? 'cpu_' + parts[2].toLowerCase() : 'cpu_usage';
            dataset.data = extended_data.map(item => {
                const core_data = item.cpu_cores.find(core => core.core === core_index);
                return core_data ? core_data[metric] : null;
            });
        });

        system_cores.data.labels = x_axis_labels;
        system_cores.update();
    }
}

function findProcessForSelection(item, selection) {
    if (!item || !item.processes || !selection) return null;
    switch (selection.mode) {
        case 'pid':
            return item.processes.find(p => p.pid === selection.pid) || null;
        case 'name': {
            const byName = item.processes.filter(p => p.name === selection.name);
            if (byName.length === 0) return null;
            if (byName.length === 1) return byName[0];
            if (selection.pid) {
                const byPid = byName.find(p => p.pid === selection.pid);
                if (byPid) return byPid;
            }
            return null;
        }
        case 'pid+name':
            return item.processes.find(p => p.pid === selection.pid && p.name === selection.name) || null;
    }
    return null;
}

function initProcessCharts(metrics) {
    const latest_data = data_storage.last();
    const processList = latest_data ? latest_data.processes : [];

    const activeSelections = new Map();

    // Parse metrics
    metrics.forEach(metric => {
        if (metric.startsWith('pid=')) {
            const pid = parseInt(metric.split('=')[1], 10);
            if (!isNaN(pid)) {
                const sel = { pid, name: '', mode: 'pid' };
                activeSelections.set(getSelectionKey(sel), sel);
            }
        } else if (metric.startsWith('name=')) {
            const name = metric.split('=').slice(1).join('=');
            if (name) {
                const sel = { pid: 0, name, mode: 'name' };
                activeSelections.set(getSelectionKey(sel), sel);
            }
        } else if (metric.startsWith('pid+name=')) {
            const rest = metric.split('=').slice(1).join('=');
            const [pidStr, name] = rest.split(':', 2);
            const pid = parseInt(pidStr, 10);
            if (!isNaN(pid) && name) {
                const sel = { pid, name, mode: 'pid+name' };
                activeSelections.set(getSelectionKey(sel), sel);
            }
        }
    });

    // global appliedProcessSelections are also persistent
    if (typeof appliedProcessSelections !== 'undefined') {
        appliedProcessSelections.forEach((sel, key) => {
            activeSelections.set(key, sel);
        });
    }

    // comm= selections only match currently running processes
    const comms = metrics.filter(metric => metric.startsWith('comm='));
    if (latest_data && comms.length > 0) {
        latest_data.processes.forEach(proc => {
            if (comms.some(c => proc.name.includes(c.split('=')[1]))) {
                const sel = { pid: proc.pid, name: proc.name, mode: 'pid' };
                activeSelections.set(getSelectionKey(sel), sel);
            }
        });
    }

    // Create or keep charts for all active selections
    for (const [key, selection] of activeSelections) {
        const currentProcess = findProcessForSelection(latest_data, selection);
        const process_id = currentProcess ? currentProcess.pid : (selection.pid || 0);
        const process_name = currentProcess ? currentProcess.name : (findProcessNameByPid(process_id) || selection.name || 'unknown');
        const process_threads = currentProcess ? currentProcess.threads : [];
        const initialInstanceKey = currentProcess ? (currentProcess.starttime ? `${currentProcess.pid}:${currentProcess.starttime}` : String(currentProcess.pid)) : null;

        if (!process_charts[key]) {
            const chart_id_prefix = key.replace(/[^a-zA-Z0-9]/g, '_');
            const process_display = `${process_name} (pid=${process_id})`;
            const memory_title = `[${process_display}] Memory(MB)`;
            const [process_memory_chart, process_memory_ctx, memory_stats_id, memory_wrapper] = addChart(`Process_${chart_id_prefix}_Memory`, 'Memory(MB)', false, memory_title);
            const process_memory_label = 'USED MEMORY';
            process_memory_chart.data.datasets.push({
                label: process_memory_label,
                data: data_storage.data.map(item => {
                    const proc = findProcessForSelection(item, selection);
                    return proc ? proc.memory : null;
                }),
                borderColor: getColorForLabel(process_memory_label),
                backgroundColor: 'rgba(0, 0, 0, 0)',
                borderWidth: 1,
                fill: false
            });
            process_memory_chart.update();

            const cpu_title = `[${process_display}] CPU Usage (%)`;
            const [process_cpu_chart, process_cpu_ctx, cpu_stats_id, cpu_wrapper] = addChart(`Process_${chart_id_prefix}_CPU`, 'CPU Usage (%)', false, cpu_title);
            const process_cpu_group_label = 'CPU Total';
            process_cpu_chart.data.datasets.push({
                label: process_cpu_group_label,
                data: data_storage.data.map(item => {
                    const proc = findProcessForSelection(item, selection);
                    return proc ? proc.cpu_usage : null;
                }),
                borderColor: getColorForLabel(process_cpu_group_label),
                backgroundColor: 'rgba(0, 0, 0, 0)',
                borderWidth: 1,
                fill: false,
                isGroup: true
            });
            ['CPU User', 'CPU System'].forEach(childLabel => {
                const field = childLabel === 'CPU User' ? 'cpu_user' : 'cpu_system';
                process_cpu_chart.data.datasets.push({
                    label: childLabel,
                    data: data_storage.data.map(item => {
                        const proc = findProcessForSelection(item, selection);
                        return proc ? proc[field] : null;
                    }),
                    borderColor: getColorForLabel(childLabel),
                    backgroundColor: 'rgba(0, 0, 0, 0)',
                    borderWidth: 1,
                    fill: false,
                    parentLabel: process_cpu_group_label,
                    hidden: true
                });
            });
            process_cpu_chart.update();

            const thread_cpu_title = `[${process_display}] Thread CPU Usage (%)`;
            const [process_thread_cpu_chart, process_thread_cpu_ctx, thread_cpu_stats_id, thread_cpu_wrapper] = addChart(`Process_${chart_id_prefix}_ThreadsCPU`, 'Thread CPU Usage (%)', false, thread_cpu_title);
            process_threads.forEach(thread => {
                const thread_label = `Thread[${thread.priority}] ${thread.tid}`;
                process_thread_cpu_chart.data.datasets.push({
                    label: thread_label,
                    data: data_storage.data.map(item => {
                        const proc = findProcessForSelection(item, selection);
                        if (proc) {
                            const thread_data = proc.threads.find(t => t.tid === thread.tid);
                            return thread_data ? thread_data.cpu_usage : null;
                        }
                        return null;
                    }),
                    borderColor: getColorForLabel(thread_label),
                    backgroundColor: 'rgba(0, 0, 0, 0)',
                    borderWidth: 1,
                    fill: false,
                    isGroup: true
                });
                ['User', 'System'].forEach(childSuffix => {
                    const childLabel = `${thread_label} ${childSuffix}`;
                    const field = childSuffix === 'User' ? 'cpu_user' : 'cpu_system';
                    process_thread_cpu_chart.data.datasets.push({
                        label: childLabel,
                        data: data_storage.data.map(item => {
                            const proc = findProcessForSelection(item, selection);
                            if (proc) {
                                const thread_data = proc.threads.find(t => t.tid === thread.tid);
                                return thread_data ? thread_data[field] : null;
                            }
                            return null;
                        }),
                        borderColor: getColorForLabel(childLabel),
                        backgroundColor: 'rgba(0, 0, 0, 0)',
                        borderWidth: 1,
                        fill: false,
                        parentLabel: thread_label,
                        hidden: true
                    });
                });
            });
            process_thread_cpu_chart.update();

            process_charts[key] = {
                memory: process_memory_chart,
                memory_ctx: process_memory_ctx,
                memory_stats_id: memory_stats_id,
                memory_wrapper: memory_wrapper,
                cpu: process_cpu_chart,
                cpu_ctx: process_cpu_ctx,
                cpu_stats_id: cpu_stats_id,
                cpu_wrapper: cpu_wrapper,
                thread_cpu: process_thread_cpu_chart,
                thread_cpu_ctx: process_thread_cpu_ctx,
                thread_cpu_stats_id: thread_cpu_stats_id,
                thread_cpu_wrapper: thread_cpu_wrapper,
                title: process_display,
                selection: selection,
                instanceKey: initialInstanceKey,
                restartedUntil: 0
            };
        }
    }

    // 移除未指定的进程图表
    for (const key in process_charts) {
        if (!activeSelections.has(key)) {
            const process_chart = process_charts[key];
            if (process_chart) {
                process_chart.memory.destroy();
                process_chart.cpu.destroy();
                process_chart.thread_cpu.destroy();
                delete process_charts[key];

                if (process_chart.memory_wrapper && process_chart.memory_wrapper.parentNode) {
                    process_chart.memory_wrapper.parentNode.removeChild(process_chart.memory_wrapper);
                }
                if (process_chart.cpu_wrapper && process_chart.cpu_wrapper.parentNode) {
                    process_chart.cpu_wrapper.parentNode.removeChild(process_chart.cpu_wrapper);
                }
                if (process_chart.thread_cpu_wrapper && process_chart.thread_cpu_wrapper.parentNode) {
                    process_chart.thread_cpu_wrapper.parentNode.removeChild(process_chart.thread_cpu_wrapper);
                }
            }
        }
    }
}

function colorToHex(color) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = color;
    return ctx.fillStyle;
}

function setColorOverride(label, color) {
    if (typeof colorOverrides === 'undefined') return;
    colorOverrides[label] = color;
    applyColorOverride(label, color);
}

function applyColorOverride(label, color) {
    function updateChartDatasets(chart) {
        if (!chart || !chart.data) return;
        chart.data.datasets.forEach(dataset => {
            if (dataset.label === label) {
                dataset.borderColor = color;
            }
        });
        chart.update();
    }
    updateChartDatasets(system_charts['system_memory']?.chart);
    updateChartDatasets(system_charts['system_cpu']?.chart);
    updateChartDatasets(system_charts['system_cores']?.chart);
    for (const pid in process_charts) {
        const pc = process_charts[pid];
        if (pc) {
            updateChartDatasets(pc.memory);
            updateChartDatasets(pc.cpu);
            updateChartDatasets(pc.thread_cpu);
        }
    }
}

function randomizeColorForLabel(label) {
    const color = getRandomColor();
    setColorOverride(label, color);
    updateAllStatistics();
    if (typeof saveColorOverridesForIp === 'function') saveColorOverridesForIp();
    return color;
}

function randomizeAllColors() {
    if (typeof colorOverrides === 'undefined') return;

    const labels = new Set();
    function collectLabels(chart) {
        if (!chart || !chart.data) return;
        chart.data.datasets.forEach(dataset => labels.add(dataset.label));
    }
    collectLabels(system_charts['system_memory']?.chart);
    collectLabels(system_charts['system_cpu']?.chart);
    collectLabels(system_charts['system_cores']?.chart);
    for (const pid in process_charts) {
        const pc = process_charts[pid];
        if (pc) {
            collectLabels(pc.memory);
            collectLabels(pc.cpu);
            collectLabels(pc.thread_cpu);
        }
    }

    const colorMap = {};
    labels.forEach(label => {
        const color = getRandomColor();
        colorOverrides[label] = color;
        colorMap[label] = color;
    });

    function applyColorMap(chart) {
        if (!chart || !chart.data) return;
        chart.data.datasets.forEach(dataset => {
            const color = colorMap[dataset.label];
            if (color) {
                dataset.borderColor = color;
            }
        });
        chart.update();
    }
    applyColorMap(system_charts['system_memory']?.chart);
    applyColorMap(system_charts['system_cpu']?.chart);
    applyColorMap(system_charts['system_cores']?.chart);
    for (const pid in process_charts) {
        const pc = process_charts[pid];
        if (pc) {
            applyColorMap(pc.memory);
            applyColorMap(pc.cpu);
            applyColorMap(pc.thread_cpu);
        }
    }

    updateAllStatistics();
    if (typeof saveColorOverridesForIp === 'function') saveColorOverridesForIp();
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
    if (typeof colorOverrides !== 'undefined' && colorOverrides && colorOverrides[label]) {
        return colorOverrides[label];
    }
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
