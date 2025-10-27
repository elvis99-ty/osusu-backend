const bcrypt = require('bcryptjs');

async function hashPassword() {
    const password = 'admin12345'; // <-- ENSURE THIS IS EXACTLY 'admin12345'
    const hashedPassword = await bcrypt.hash(password, 10);
    console.log('Hashed Password for "admin12345":', hashedPassword);
}
hashPassword();