const express = require("express");
const path = require("path");
const Database = require("better-sqlite3");
const session = require("express-session");
const nodemailer = require("nodemailer"); 

const app = express();
const PORT = process.env.PORT || 3000;

// Session Setup
app.use(session({
    secret: 'swastha-mitra-secret-key-1234',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

// 🔴 NAYA UPDATE: Timeout error ko theek karne ke liye (Host aur Port add kiya)
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true, 
    auth: {
        user: 'bhaiyaaman432@gmail.com', 
        pass: 'ysrfpvueutddqbxc'         
    }
});

// Database Connection
const db = new Database("swasthamitra.db");

db.prepare(`
    CREATE TABLE IF NOT EXISTS members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        membership_id TEXT,
        full_name TEXT NOT NULL,
        mobile TEXT NOT NULL,
        email TEXT,
        age INTEGER,
        family_members INTEGER,
        address TEXT,
        health TEXT,
        payment_date TEXT,
        start_date TEXT,
        expiry_date TEXT,
        amount_paid TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
`).run();

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
app.post("/api/admin-login", async (req, res) => {
    const { username, password } = req.body;
    
    const ADMIN_USER = "admin";
    const ADMIN_PASS = "12345";

    if (username === ADMIN_USER && password === ADMIN_PASS) {
        const otp = Math.floor(100000 + Math.random() * 900000).toString(); 
        req.session.pendingOtp = otp; 

        try {
            await transporter.sendMail({
                from: '"Swastha Mitra Security" <bhaiyaaman432@gmail.com>',
                to: 'bhaiyaaman432@gmail.com',
                subject: 'Admin Panel Login - Security OTP',
                html: `<h3>Swastha Mitra Admin Login</h3>
                       <p>Kisi ne Admin Panel login karne ki koshish ki hai.</p>
                       <p>Aapka Login OTP hai: <strong><span style="font-size:24px; color:green;">${otp}</span></strong></p>
                       <p>Yeh OTP kisi ke sath share na karein.</p>`
            });
            
            res.json({ success: true, requireOtp: true, message: "Password sahi hai! OTP aapki email par bhej diya gaya hai." });
        } catch (error) {
            console.log("Email Error:", error); // Yeh server log mein error dikhayega
            res.json({ success: false, message: "Email bhejne mein dikkat aayi." });
        }
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

// API 1: Register
app.post("/register", (req, res) => {
    try {
        const { fullName, mobile, email, age, familyMembers, address, health, planType } = req.body;
        
        const membershipId = "SM-" + Math.floor(100000 + Math.random() * 900000);
        const paymentDate = new Date().toISOString().split('T')[0];
        
        let expiryObj = new Date();
        let amountPaid = "";

        if (planType === "renew") {
            expiryObj.setMonth(expiryObj.getMonth() + 1);
            amountPaid = "₹50 (1 Month Renewal)";
        } else if (planType === "first_6m") {
            expiryObj.setMonth(expiryObj.getMonth() + 6);
            amountPaid = "₹99 (6 Months First Time)";
        } else {
            expiryObj.setMonth(expiryObj.getMonth() + 3);
            amountPaid = "₹50 (3 Months First Time)";
        }
        
        const expiryDate = expiryObj.toISOString().split('T')[0];

        const stmt = db.prepare(`
            INSERT INTO members (membership_id, full_name, mobile, email, age, family_members, address, health, payment_date, start_date, expiry_date, amount_paid)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        stmt.run(membershipId, fullName, mobile, email, age, familyMembers, address, health, paymentDate, paymentDate, expiryDate, amountPaid);
        res.json({ success: true, message: "Success!", membershipId: membershipId });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error occurred." });
    }
});

// API 2: Get all Members
app.get("/admin/members", (req, res) => {
    try {
        const rows = db.prepare("SELECT * FROM members ORDER BY id DESC").all();
        res.json({ success: true, members: rows });
    } catch (error) {
        res.status(500).json({ success: false, message: "Database error" });
    }
});

// API 3: Delete Member
app.delete("/admin/members/:id", (req, res) => {
    try {
        const { id } = req.params;
        db.prepare("DELETE FROM members WHERE id = ?").run(id);
        res.json({ success: true, message: "Member deleted successfully!" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Error deleting member." });
    }
});

// API 4: Update Member
app.put("/admin/members/:id", (req, res) => {
    try {
        const { id } = req.params;
        const { fullName, mobile, email, age, familyMembers, address, health } = req.body;
        
        const stmt = db.prepare(`
            UPDATE members 
            SET full_name = ?, mobile = ?, email = ?, age = ?, family_members = ?, address = ?, health = ?
            WHERE id = ?
        `);
        stmt.run(fullName, mobile, email, age, familyMembers, address, health, id);
        res.json({ success: true, message: "Member details updated successfully!" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Error updating member." });
    }
});

// API 5: Customer Login
app.post("/login", (req, res) => {
    try {
        const { mobile } = req.body;
        const member = db.prepare("SELECT * FROM members WHERE mobile = ?").get(mobile);
        
        if (member) {
            res.json({ success: true, message: "Login successful!", member: member });
        } else {
            res.json({ success: false, message: "Mobile number not found!" });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: "Something went wrong." });
    }
});

// Server Start
app.listen(PORT, "0.0.0.0", () => {
    console.log(`Swastha Mitra server is RUNNING at port ${PORT}`);
});