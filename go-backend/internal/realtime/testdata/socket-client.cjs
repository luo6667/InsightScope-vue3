const { createRequire } = require('node:module');
const path = require('node:path');
const requireWeb = createRequire(path.resolve(process.cwd(), '../../../web/package.json'));
const { io } = requireWeb('socket.io-client');

const serverURL = process.argv[2];
const failed = io(serverURL, { transports: ['websocket', 'polling'], auth: { token: 'wrong' }, extraHeaders: { Origin: 'http://localhost:5175' }, reconnection: false, timeout: 3000 });
const socket = io(serverURL, { transports: ['websocket', 'polling'], auth: { token: 'secret' }, extraHeaders: { Origin: 'http://localhost:5175' }, reconnection: false, timeout: 3000 });
const timeout = setTimeout(() => finish(new Error('Socket.IO compatibility timeout')), 5000);
let unauthorized = false;
let joined = false;
let progress = false;
let left = false;

function finish(error) {
  clearTimeout(timeout);
  failed.disconnect();
  socket.disconnect();
  if (error) { console.error(error); process.exitCode = 1; }
  else console.log('auth, join, room event and leave passed');
}

failed.on('connect', () => finish(new Error('invalid token connected')));
failed.on('connect_error', (error) => {
  if (error.message !== 'unauthorized') finish(error);
  else { unauthorized = true; failed.disconnect(); }
});
socket.on('connect_error', finish);
socket.on('connect', () => socket.emit('join-dataset', '8'));
socket.on('joined', () => { joined = true; socket.emit('trigger'); });
socket.on('analysis:progress', (payload) => {
  if (left) return finish(new Error('received room event after leaving'));
  if (!joined || payload.datasetId !== '8') return finish(new Error('bad room payload'));
  progress = true;
  socket.emit('leave-dataset', '8');
});
socket.on('left', () => {
  if (!progress) return finish(new Error('left before receiving room event'));
  left = true;
  socket.emit('trigger');
  setTimeout(() => { if (unauthorized) finish(); }, 250);
});
