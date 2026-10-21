"use strict";

document.addEventListener("DOMContentLoaded", function () {
    const amountField = document.getElementById("fund-amount");
    const result = document.getElementById("fund-result");

    if (!amountField || !result) {
        return;
    }

    function updateEstimate() {
        const amount = amountField.valueAsNumber;
        if (!Number.isFinite(amount) || amount < 0) {
            result.textContent = "Enter a valid non-negative amount.";
            return;
        }
        result.textContent = new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD"
        }).format(amount * 0.02);
    }

    amountField.addEventListener("input", updateEstimate);
    updateEstimate();
});
