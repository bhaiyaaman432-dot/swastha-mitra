const express = require("express");
const path = require("path");
const session = require("express-session");
const { createClient } = require("@libsql/client"); // 🔴 Turso Cloud Database Client

const app = express();
const PORT = process.env.PORT || 3000;

// Session Setup
app.use(session({
    secret: 'swastha-mitra-secret-key-1234',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

// 🔴 TURSO CLOUD DATABASE CONNECTION
const db = createClient({
    url: "libsql://swasthamitra-bhaiyaaman432-dot.aws-ap-south-1.turso.io",
    authToken: "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODgxMTAxNTgsImlkIjoiMDFhMDUzYTctYmEwMS03NmRiLTg0MmEtMjYwNmVlMmFhYWUzIiwia2lkIjoiZl94Rmg1ZDdTOWdIXzNvdUdlRnFJbjd6Qy1RVlY2dU45bGNQeTVlYlpKTSIsInJpZCI6ImE5YWQ0ZmE5LTE0MmQtNDU5MC05NDhkLTZhMzgwYjcyZDM1YiJ9.lJoM-_kg4LJZgjZhmKM0-cNolJ_fUYS5wUoAAsDXixirUBCXiuSIUhoaSedR5ax7sEfH99P5YVraGOKyyK2ECQ"
});

// 🛠️ Table Create karna
async function initDB() {
    try {
        await db.execute(`
            CREATE TABLE IF NOT EXISTS members (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                membership_id TEXT,
                full_name TEXT NOT NULL,
                mobile TEXT NOT NULL,
                email TEXT,
                age INTEGER,
                family_count INTEGER,
                address TEXT,
                health TEXT,
                admission_date TEXT,
                expiry_date TEXT,
                amount_paid TEXT,
                remaining_days INTEGER,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log("Cloud Database Table Ready!");
    } catch (err) {
        console.log("DB Table Error:", err);
    }
}
initDB();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// 🛡️ SECURITY GUARD
function checkAuth(req, res, next) {
    if (req.session.loggedIn) {
        next(); 
    } else {
        res.redirect("/admin-login"); 
    }
}

// 📄 HTML Pages Routes
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/dashboard", (req, res) => res.sendFile(path.join(__dirname, "dashboard.html")));
app.get("/admin-login", (req, res) => res.sendFile(path.join(__dirname, "admin-login.html")));

// 🔒 Admin page secure
app.get("/admin", checkAuth, (req, res) => {
    res.sendFile(path.join(__dirname, "admin.html"));
});

// 🔑 Admin Login Check
app.post("/api/admin-login", (req, res) => {
    const { username, password } = req.body;
    
    const ADMIN_USER = "admin";
    const ADMIN_PASS = "12345";

    if (username === ADMIN_USER && password === ADMIN_PASS) {
        const otp = Math.floor(100000 + Math.random() * 900000).toString(); 
        req.session.pendingOtp = otp; 
        res.json({ success: true, requireOtp: true, otp: otp, message: "Password sahi hai!" });
    } else {
        res.json({ success: false, message: "Galat Username ya Password!" });
    }
});

// 🔴 API: OTP Check Karne Ke Liye
app.post("/api/admin-verify-otp", (req, res) => {
    const { otp } = req.body;
    if (req.session.pendingOtp && req.session.pendingOtp === otp) {
        req.session.loggedIn = true; 
        req.session.pendingOtp = null; 
        res.json({ success: true, message: "Welcome Admin! Login Successful." });
    } else {
        res.json({ success: false, message: "Galat OTP! Kripaya sahi OTP dalein." });
    }
});

// 🚪 Admin Logout API
app.get("/api/admin-logout", (req, res) => {
    req.session.destroy(); 
    res.redirect("/admin-login"); 
});

// API 1: Register (Family Count Safe Handling)
app.post("/register", async (req, res) => {
    try {
        const { fullName, mobile, email, age, address, health, planType } = req.body;
        const familyCount = req.body.familyMembers || req.body.family || req.body.family_count || req.body.family_members || 1;
        
        const membershipId = "SM-" + Math.floor(100000 + Math.random() * 900000);
        const admissionDate = new Date().toISOString().split('T')[0];
        
        let expiryObj = new Date();
        let amountPaid = "";

        if (planType === "renew") {
            expiryObj.setMonth(expiryObj.getMonth() + 1);
            amountPaid = "Rs. 50 (1 Month Renewal)";
        } else if (planType === "first_6m") {
            expiryObj.setMonth(expiryObj.getMonth() + 6);
            amountPaid = "Rs. 99 (6 Months First Time)";
        } else {
            expiryObj.setMonth(expiryObj.getMonth() + 3);
            amountPaid = "Rs. 50 (3 Months First Time)";
        }
        
        const expiryDate = expiryObj.toISOString().split('T')[0];
        const diffTime = new Date(expiryDate) - new Date();
        const remainingDays = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));

        await db.execute({
            sql: `INSERT INTO members (membership_id, full_name, mobile, email, age, family_count, address, health, admission_date, expiry_date, amount_paid, remaining_days)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [membershipId, fullName, mobile, email, age, familyCount, address, health, admissionDate, expiryDate, amountPaid, remainingDays]
        });
        
        res.json({ success: true, message: "Success!", membershipId: membershipId });
    } catch (error) {
        console.log("Register API Error:", error);
        res.status(500).json({ success: false, message: "Server error occurred." });
    }
});

// API 2: Get all Members (Mapped with clean Sr. No.)
app.get("/admin/members", async (req, res) => {
    try {
        const result = await db.execute("SELECT * FROM members ORDER BY id DESC");
        const formattedMembers = result.rows.map((row, index) => ({
            ...row,
            sr_no: result.rows.length - index
        }));
        res.json({ success: true, members: formattedMembers });
    } catch (error) {
        console.log("Fetch Members Error:", error);
        res.status(500).json({ success: false, message: "Database error" });
    }
});

// API 3: Delete Member
app.delete("/admin/members/:id", async (req, res) => {
    try {
        const { id } = req.params;
        await db.execute({
            sql: "DELETE FROM members WHERE id = ?",
            args: [id]
        });
        res.json({ success: true, message: "Member deleted successfully!" });
    } catch (error) {
        console.log("Delete Member Error:", error);
        res.status(500).json({ success: false, message: "Error deleting model/member." });
    }
});

// API 4: Update Member
app.put("/admin/members/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const { fullName, mobile, email, age, address, health } = req.body;
        const familyCount = req.body.familyMembers || req.body.family || req.body.family_count || req.body.family_members || 1;
        
        await db.execute({
            sql: `UPDATE members 
                  SET full_name = ?, mobile = ?, email = ?, age = ?, family_count = ?, address = ?, health = ?
                  WHERE id = ?`,
            args: [fullName, mobile, email, age, familyCount, address, health, id]
        });
        res.json({ success: true, message: "Member details updated successfully!" });
    } catch (error) {
        console.log("Update Member Error:", error);
        res.status(500).json({ success: false, message: "Error updating member." });
    }
});

// API 5: Customer Login
app.post("/login", async (req, res) => {
    try {
        const { mobile } = req.body;
        const result = await db.execute({
            sql: "SELECT * FROM members WHERE mobile = ?",
            args: [mobile]
        });
        
        if (result.rows.length > 0) {
            res.json({ success: true, message: "Login successful!", member: result.rows[0] });
        } else {
            res.json({ success: false, message: "Mobile number not found!" });
        }
    } catch (error) {
        console.log("Login Error:", error);
        res.status(500).json({ success: false, message: "Something went wrong." });
    }
});

// Server Start
app.listen(PORT, "0.0.0.0", () => {
    console.log(`Swastha Mitra server is RUNNING at port ${PORT}`);
});