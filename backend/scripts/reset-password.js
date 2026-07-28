// reset-password.js
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");

const email = process.env.EMAIL;
const newPass = process.env.NEWPASS;

if (!email || !newPass) {
    console.error("Please set EMAIL and NEWPASS environment variables");
    process.exit(1);
}

(async () => {
    const hash = await bcrypt.hash(newPass, 12);
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const { rowCount } = await pool.query(
        "UPDATE teachers SET password_hash = $2, password_changed_at = NOW() WHERE email = $1",
        [email, hash]
    );
    console.log(rowCount ? "√ password updated for " + email : "× no teacher with that email");
    await pool.end();
})();