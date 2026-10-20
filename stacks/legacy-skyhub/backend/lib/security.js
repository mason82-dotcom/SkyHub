const { timingSafeEqual } = require('crypto');

function safeEqual(left, right) {
    if (typeof left !== 'string' || typeof right !== 'string') return false;
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function bearerToken(header) {
    if (typeof header !== 'string') return undefined;
    const match = /^Bearer ([A-Za-z0-9._~+/-]{24,512})$/.exec(header);
    return match ? match[1] : undefined;
}

function requireAdminToken(expectedToken) {
    return (req, res, next) => {
        if (typeof expectedToken !== 'string' || expectedToken.length < 32) {
            return res.status(503).json({ error: 'Admin-Aktionen sind nicht konfiguriert' });
        }
        if (!safeEqual(bearerToken(req.get('authorization')), expectedToken)) {
            return res.status(401).json({ error: 'Admin-Autorisierung erforderlich' });
        }
        next();
    };
}

module.exports = { bearerToken, requireAdminToken, safeEqual };
