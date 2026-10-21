"use strict";

document.addEventListener("DOMContentLoaded", async function () {
    const status = document.getElementById("rewards-status");
    const dashboard = document.getElementById("rewards-dashboard");
    const gateway = document.getElementById("rewards-gateway");
    const score = document.getElementById("creator-trust-score");

    if (!status || !dashboard || !gateway || !score) {
        return;
    }

    try {
        const response = await fetch("/api/community/me", {
            headers: { Accept: "application/json" }
        });
        const payload = await response.json();
        if (!response.ok) {
            throw new Error(payload.error || "Your account status could not be loaded.");
        }

        if (!payload.user) {
            status.textContent = "Sign in to view your creator trust score and activity.";
            gateway.hidden = false;
            return;
        }

        if (!Number.isInteger(payload.user.trustScore) ||
            payload.user.trustScore < 0 || payload.user.trustScore > 100) {
            throw new Error("The account service returned an invalid creator score.");
        }

        score.textContent = String(payload.user.trustScore);
        dashboard.hidden = false;
        status.textContent = "Signed in as " + payload.user.displayName + ".";
    } catch (error) {
        status.textContent = error.message;
    }
});
