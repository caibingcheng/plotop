const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const vendorDir = path.join(projectRoot, 'dist', 'renderer', 'vendor');

const vendors = [
  {
    src: path.join(projectRoot, 'node_modules', 'socket.io-client', 'dist', 'socket.io.js'),
    dest: path.join(vendorDir, 'socket.io.js'),
  },
  {
    src: path.join(projectRoot, 'node_modules', 'chart.js', 'dist', 'chart.umd.js'),
    dest: path.join(vendorDir, 'chart.umd.js'),
  },
  {
    src: path.join(projectRoot, 'node_modules', 'chartjs-adapter-date-fns', 'dist', 'chartjs-adapter-date-fns.bundle.min.js'),
    dest: path.join(vendorDir, 'chartjs-adapter-date-fns.umd.js'),
  },
  {
    src: path.join(projectRoot, 'node_modules', 'html2canvas', 'dist', 'html2canvas.min.js'),
    dest: path.join(vendorDir, 'html2canvas.min.js'),
  },
];

if (!fs.existsSync(vendorDir)) {
  fs.mkdirSync(vendorDir, { recursive: true });
}

let hasError = false;
for (const vendor of vendors) {
  if (!fs.existsSync(vendor.src)) {
    console.error(`Vendor source not found: ${vendor.src}`);
    hasError = true;
    continue;
  }
  fs.copyFileSync(vendor.src, vendor.dest);
  console.log(`Copied ${path.basename(vendor.src)} -> ${vendor.dest}`);
}

if (hasError) {
  process.exit(1);
}
