// Simple console-based view layer for consistent logs and masking

function maskEmail(email) {
  if (!email) return '';
  const [user, domain] = String(email).split('@');
  if (!domain) return String(email).replace(/.(?=.{2})/g, '*');
  const maskedUser = user.length <= 2 ? user[0] + '*' : user[0] + '*'.repeat(Math.max(1, user.length - 2)) + user[user.length - 1];
  return maskedUser + '@' + domain;
}

function info(msg) {
  console.log(`[INFO] ${msg}`);
}

function warn(msg) {
  console.warn(`[WARN] ${msg}`);
}

function error(msg) {
  console.error(`[ERROR] ${msg}`);
}

module.exports = { info, warn, error, maskEmail };

