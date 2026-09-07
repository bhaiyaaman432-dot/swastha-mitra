const express = require("express");
const path = require("path");
const session = require("express-session");
const { createClient } = require("@libsql/client");

const app = express();
const PORT = process.env.PORT || 3000;

/* =========================================================
   SESSION SETUP
   ========================================================= */

app.use(
    session({
        secret: process.env.SESSION_SECRET || "CHANGE_THIS_SESSION_SECRET",
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: false,
            httpOnly: true,
            sameSite: "lax",
            maxAge: 24 * 60 * 60 * 1000
        }
    })
);

/* =========================================================
   TURSO DATABASE
   IMPORTANT:
   Add these in Render Environment Variables:
   TURSO_DATABASE_URL
   TURSO_AUTH_TOKEN
   ========================================================= */

const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN
});

/* =========================================================
   MIDDLEWARE
   ========================================================= */

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

/* =========================================================
   DATABASE INITIALIZATION
   ========================================================= */

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
                family_count INTEGER DEFAULT 1,
                address TEXT,
                health TEXT,
                admission_date TEXT,
                expiry_date TEXT,
                amount_paid TEXT,
                remaining_days INTEGER DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);

        console.log("Cloud Database Table Ready!");
    } catch (err) {
        console.error("DB Table Error:", err);
    }
}

initDB();

/* =========================================================
   HELPER: VALID NUMBER
   ========================================================= */

function toSafeNumber(value, fallback = 0) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
        return fallback;
    }

    return number;
}

/* =========================================================
   HELPER: FAMILY COUNT
   Supports:
   familyMembers
   family
   family_count
   family_members
   ========================================================= */

function getFamilyCount(body) {
    const rawValue =
        body.familyMembers ??
        body.family ??
        body.family_count ??
        body.family_members ??
        1;

    const familyCount = toSafeNumber(rawValue, 1);

    return Math.max(1, Math.floor(familyCount));
}

/* =========================================================
   HELPER: FORMAT DATE
   YYYY-MM-DD
   ========================================================= */

function formatDate(date) {
    return date.toISOString().split("T")[0];
}

/* =========================================================
   HELPER: CALCULATE REMAINING DAYS
   This is ALWAYS calculated from expiry_date.
   It does NOT depend on stored remaining_days.
   ========================================================= */

function calculateRemainingDays(expiryDate) {
    if (!expiryDate) {
        return 0;
    }

    const today = new Date();
    const expiry = new Date(`${expiryDate}T00:00:00`);

    if (Number.isNaN(expiry.getTime())) {
        return 0;
    }

    today.setHours(0, 0, 0, 0);
    expiry.setHours(0, 0, 0, 0);

    const diffTime = expiry.getTime() - today.getTime();

    return Math.max(
        0,
        Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    );
}

/* =========================================================
   HELPER: MEMBER STATUS
   ========================================================= */

function getMemberStatus(expiryDate) {
    const remainingDays = calculateRemainingDays(expiryDate);

    return remainingDays > 0 ? "ACTIVE" : "EXPIRED";
}

/* =========================================================
   HELPER: FORMAT MEMBER
   This fixes:
   family = undefined
   admissionDate missing
   expiryDate missing
   remainingDays missing
   status missing
   ========================================================= */

function formatMember(row) {
    const familyCount = Math.max(
        1,
        toSafeNumber(row.family_count, 1)
    );

    const remainingDays = calculateRemainingDays(
        row.expiry_date
    );

    const status =
        remainingDays > 0 ? "ACTIVE" : "EXPIRED";

    return {
        // Original database fields
        id: row.id,
        membership_id: row.membership_id,
        full_name: row.full_name,
        mobile: row.mobile,
        email: row.email,
        age: row.age,
        family_count: familyCount,
        address: row.address,
        health: row.health,
        admission_date: row.admission_date,
        expiry_date: row.expiry_date,
        amount_paid: row.amount_paid,
        created_at: row.created_at,

        // Frontend-friendly aliases
        membershipId: row.membership_id,

        fullName: row.full_name,

        family: familyCount,
        familyMembers: familyCount,

        admissionDate: row.admission_date,

        expiryDate: row.expiry_date,

        remainingDays: remainingDays,

        status: status,

        // Useful display text
        subscriptionStatus: status,

        daysRemainingText:
            remainingDays > 0
                ? `${remainingDays} Days Remaining`
                : "Subscription Expired"
    };
}

/* =========================================================
   SECURITY GUARD
   ========================================================= */

function checkAuth(req, res, next) {
    if (req.session.loggedIn) {
        next();
    } else {
        res.redirect("/admin-login");
    }
}

/* =========================================================
   HTML ROUTES
   ========================================================= */

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/dashboard", (req, res) => {
    res.sendFile(path.join(__dirname, "dashboard.html"));
});

app.get("/admin-login", (req, res) => {
    res.sendFile(path.join(__dirname, "admin-login.html"));
});

app.get("/admin", checkAuth, (req, res) => {
    res.sendFile(path.join(__dirname, "admin.html"));
});

/* =========================================================
   ADMIN LOGIN
   ========================================================= */

app.post("/api/admin-login", (req, res) => {
    try {
        const { username, password } = req.body;

        const ADMIN_USER =
            process.env.ADMIN_USER || "admin";

        const ADMIN_PASS =
            process.env.ADMIN_PASS || "CHANGE_THIS_PASSWORD";

        if (
            username !== ADMIN_USER ||
            password !== ADMIN_PASS
        ) {
            return res.json({
                success: false,
                message: "Galat Username ya Password!"
            });
        }

        const otp = Math.floor(
            100000 + Math.random() * 900000
        ).toString();

        req.session.pendingOtp = otp;

        /*
         IMPORTANT:
         Production mein OTP ko SMS/email se bhejna chahiye.
         Testing ke liye response mein OTP diya gaya hai.
        */

        return res.json({
            success: true,
            requireOtp: true,

            // TESTING PURPOSE ONLY
            otp: otp,

            message: "Password sahi hai!"
        });

    } catch (error) {
        console.error("Admin Login Error:", error);

        return res.status(500).json({
            success: false,
            message: "Server error."
        });
    }
});

/* =========================================================
   ADMIN OTP VERIFY
   ========================================================= */

app.post("/api/admin-verify-otp", (req, res) => {
    try {
        const { otp } = req.body;

        if (
            req.session.pendingOtp &&
            req.session.pendingOtp === otp
        ) {
            req.session.loggedIn = true;
            req.session.pendingOtp = null;

            return res.json({
                success: true,
                message: "Welcome Admin! Login Successful."
            });
        }

        return res.json({
            success: false,
            message: "Galat OTP! Kripaya sahi OTP dalein."
        });

    } catch (error) {
        console.error("OTP Error:", error);

        return res.status(500).json({
            success: false,
            message: "Server error."
        });
    }
});

/* =========================================================
   ADMIN LOGOUT
   ========================================================= */

app.get("/api/admin-logout", (req, res) => {
    req.session.destroy(() => {
        res.redirect("/admin-login");
    });
});

/* =========================================================
   API 1: REGISTER MEMBER
   ========================================================= */

app.post("/register", async (req, res) => {
    try {
        const {
            fullName,
            mobile,
            email,
            age,
            address,
            health,
            planType
        } = req.body;

        /* ------------------------------
           Basic Validation
        ------------------------------ */

        if (!fullName || !mobile || !address) {
            return res.status(400).json({
                success: false,
                message:
                    "Name, Mobile aur Address required hai."
            });
        }

        if (!/^[6-9]\d{9}$/.test(String(mobile))) {
            return res.status(400).json({
                success: false,
                message:
                    "Please valid 10-digit mobile number enter karein."
            });
        }

        /* ------------------------------
           Family Count
        ------------------------------ */

        const familyCount = getFamilyCount(req.body);

        /* ------------------------------
           Membership ID
        ------------------------------ */

        const membershipId =
            "SM-" +
            Math.floor(
                100000 + Math.random() * 900000
            );

        /* ------------------------------
           Admission Date
        ------------------------------ */

        const admissionDate = formatDate(new Date());

        /* ------------------------------
           Expiry Date
        ------------------------------ */

        const expiryObj = new Date();

        let amountPaid = "";

        if (planType === "renew") {

            expiryObj.setMonth(
                expiryObj.getMonth() + 1
            );

            amountPaid =
                "Rs. 50 (1 Month Renewal)";

        } else if (planType === "first_6m") {

            expiryObj.setMonth(
                expiryObj.getMonth() + 6
            );

            amountPaid =
                "Rs. 99 (6 Months First Time)";

        } else {

            expiryObj.setMonth(
                expiryObj.getMonth() + 3
            );

            amountPaid =
                "Rs. 50 (3 Months First Time)";
        }

        const expiryDate = formatDate(expiryObj);

        /* ------------------------------
           Remaining Days
           Calculated immediately
        ------------------------------ */

        const remainingDays =
            calculateRemainingDays(expiryDate);

        /* ------------------------------
           Insert Member
        ------------------------------ */

        await db.execute({
            sql: `
                INSERT INTO members (
                    membership_id,
                    full_name,
                    mobile,
                    email,
                    age,
                    family_count,
                    address,
                    health,
                    admission_date,
                    expiry_date,
                    amount_paid,
                    remaining_days
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,

            args: [
                membershipId,
                fullName,
                mobile,
                email || "",
                toSafeNumber(age, null),
                familyCount,
                address,
                health || "",
                admissionDate,
                expiryDate,
                amountPaid,
                remainingDays
            ]
        });

        /* ------------------------------
           Return Created Member
        ------------------------------ */

        const newMemberResult = await db.execute({
            sql: `
                SELECT *
                FROM members
                WHERE membership_id = ?
                LIMIT 1
            `,
            args: [membershipId]
        });

        const newMember =
            newMemberResult.rows.length > 0
                ? formatMember(
                    newMemberResult.rows[0]
                )
                : {
                    membershipId,
                    family: familyCount,
                    familyMembers: familyCount,
                    admissionDate,
                    expiryDate,
                    remainingDays,
                    status: "ACTIVE"
                };

        return res.json({
            success: true,
            message: "Registration successful!",
            membershipId: membershipId,
            member: newMember
        });

    } catch (error) {

        console.error(
            "Register API Error:",
            error
        );

        return res.status(500).json({
            success: false,
            message: "Server error occurred."
        });
    }
});

/* =========================================================
   API 2: GET ALL MEMBERS
   ========================================================= */

app.get("/admin/members", checkAuth, async (req, res) => {
    try {

        const result = await db.execute(
            "SELECT * FROM members ORDER BY id DESC"
        );

        const formattedMembers =
            result.rows.map((row, index) => {

                const member =
                    formatMember(row);

                return {
                    ...member,

                    sr_no:
                        result.rows.length - index
                };
            });

        return res.json({
            success: true,
            members: formattedMembers
        });

    } catch (error) {

        console.error(
            "Fetch Members Error:",
            error
        );

        return res.status(500).json({
            success: false,
            message: "Database error"
        });
    }
});

/* =========================================================
   API 3: GET SINGLE MEMBER
   ========================================================= */

app.get("/admin/members/:id", checkAuth, async (req, res) => {
    try {

        const { id } = req.params;

        const result = await db.execute({
            sql: `
                SELECT *
                FROM members
                WHERE id = ?
                LIMIT 1
            `,
            args: [id]
        });

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Member not found."
            });
        }

        return res.json({
            success: true,
            member: formatMember(
                result.rows[0]
            )
        });

    } catch (error) {

        console.error(
            "Single Member Error:",
            error
        );

        return res.status(500).json({
            success: false,
            message: "Database error"
        });
    }
});

/* =========================================================
   API 4: DELETE MEMBER
   ========================================================= */

app.delete(
    "/admin/members/:id",
    checkAuth,
    async (req, res) => {

        try {

            const { id } = req.params;

            await db.execute({
                sql:
                    "DELETE FROM members WHERE id = ?",
                args: [id]
            });

            return res.json({
                success: true,
                message:
                    "Member deleted successfully!"
            });

        } catch (error) {

            console.error(
                "Delete Member Error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Error deleting member."
            });
        }
    }
);

/* =========================================================
   API 5: UPDATE MEMBER
   ========================================================= */

app.put(
    "/admin/members/:id",
    checkAuth,
    async (req, res) => {

        try {

            const { id } = req.params;

            const {
                fullName,
                mobile,
                email,
                age,
                address,
                health,
                admissionDate,
                expiryDate
            } = req.body;

            /* ------------------------------
               Family Count
            ------------------------------ */

            const familyCount =
                getFamilyCount(req.body);

            /* ------------------------------
               Validation
            ------------------------------ */

            if (!fullName || !mobile || !address) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Name, Mobile aur Address required hai."
                });
            }

            /* ------------------------------
               Get Existing Record
            ------------------------------ */

            const existing = await db.execute({
                sql: `
                    SELECT *
                    FROM members
                    WHERE id = ?
                    LIMIT 1
                `,
                args: [id]
            });

            if (existing.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Member not found."
                });
            }

            const oldMember =
                existing.rows[0];

            /* ------------------------------
               Preserve old dates if empty
            ------------------------------ */

            const finalAdmissionDate =
                admissionDate ||
                oldMember.admission_date ||
                formatDate(new Date());

            const finalExpiryDate =
                expiryDate ||
                oldMember.expiry_date ||
                formatDate(new Date());

            /* ------------------------------
               Recalculate remaining days
            ------------------------------ */

            const remainingDays =
                calculateRemainingDays(
                    finalExpiryDate
                );

            /* ------------------------------
               Update
            ------------------------------ */

            await db.execute({
                sql: `
                    UPDATE members
                    SET
                        full_name = ?,
                        mobile = ?,
                        email = ?,
                        age = ?,
                        family_count = ?,
                        address = ?,
                        health = ?,
                        admission_date = ?,
                        expiry_date = ?,
                        remaining_days = ?
                    WHERE id = ?
                `,

                args: [
                    fullName,
                    mobile,
                    email || "",
                    toSafeNumber(age, null),
                    familyCount,
                    address,
                    health || "",
                    finalAdmissionDate,
                    finalExpiryDate,
                    remainingDays,
                    id
                ]
            });

            /* ------------------------------
               Get Updated Member
            ------------------------------ */

            const updated =
                await db.execute({
                    sql: `
                        SELECT *
                        FROM members
                        WHERE id = ?
                        LIMIT 1
                    `,
                    args: [id]
                });

            return res.json({
                success: true,
                message:
                    "Member details updated successfully!",
                member:
                    formatMember(
                        updated.rows[0]
                    )
            });

        } catch (error) {

            console.error(
                "Update Member Error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Error updating member."
            });
        }
    }
);

/* =========================================================
   API 6: CUSTOMER LOGIN
   ========================================================= */

app.post("/login", async (req, res) => {

    try {

        const mobile =
            String(req.body.mobile || "")
                .trim();

        if (!/^[6-9]\d{9}$/.test(mobile)) {
            return res.status(400).json({
                success: false,
                message:
                    "Please valid 10-digit mobile number enter karein."
            });
        }

        const result = await db.execute({
            sql: `
                SELECT *
                FROM members
                WHERE mobile = ?
                ORDER BY id DESC
                LIMIT 1
            `,
            args: [mobile]
        });

        if (result.rows.length === 0) {

            return res.json({
                success: false,
                message:
                    "Mobile number not found!"
            });
        }

        const member =
            formatMember(
                result.rows[0]
            );

        return res.json({
            success: true,
            message:
                "Login successful!",
            member: member
        });

    } catch (error) {

        console.error(
            "Login Error:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                "Something went wrong."
        });
    }
});

/* =========================================================
   API 7: MEMBER SEARCH BY MEMBERSHIP ID
   ========================================================= */

app.get(
    "/api/member/:membershipId",
    async (req, res) => {

        try {

            const {
                membershipId
            } = req.params;

            const result = await db.execute({
                sql: `
                    SELECT *
                    FROM members
                    WHERE membership_id = ?
                    LIMIT 1
                `,
                args: [membershipId]
            });

            if (result.rows.length === 0) {

                return res.status(404).json({
                    success: false,
                    message:
                        "Member not found."
                });
            }

            return res.json({
                success: true,
                member:
                    formatMember(
                        result.rows[0]
                    )
            });

        } catch (error) {

            console.error(
                "Member Search Error:",
                error
            );

            return res.status(500).json({
                success: false,
                message: "Server error."
            });
        }
    }
);

/* =========================================================
   API 8: HEALTH CHECK
   ========================================================= */

app.get("/api/health", async (req, res) => {

    try {

        await db.execute(
            "SELECT 1"
        );

        return res.json({
            success: true,
            server: "online",
            database: "connected"
        });

    } catch (error) {

        return res.status(500).json({
            success: false,
            server: "online",
            database: "error"
        });
    }
});

/* =========================================================
   SERVER START
   ========================================================= */

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `Swastha Mitra server is RUNNING on port ${PORT}`
        );
    }
);