import { test, expect } from "@playwright/test";

test("HPCSA iRegister Search and Extract", async ({ page }) => {
  console.log("🌐 Navigating to iRegister Form...");
  // Increased timeout for initial navigation
  await page.goto("https://hpcsaonline.custhelp.com/app/i_reg_form", {
    waitUntil: "networkidle",
  });

  // 1. Handle the "Close" overlay
  const closeBtn = page.getByText("Close", { exact: true });
  if (await closeBtn.isVisible()) {
    console.log("Cleaning up popup overlay...");
    await closeBtn.click();
  }

  // 2. Perform the search
  console.log("⌨️ Entering Registration Number...");
  const inputLocator = page.locator("input[id*='registrationCodeNumber']");
  await inputLocator.fill("MP0518891");

  console.log("🔍 Clicking Search button...");
  await page.getByRole("button", { name: "SEARCH iREGISTER" }).click();

  // 3. Wait for the Results Grid
  console.log("⏳ Waiting for table data to render...");
  const tableContainer = page.locator("div[id*='serialListGrid']");
  await tableContainer.waitFor({ state: "visible" });

  // Wait specifically for a data cell (ignoring the "Loading" message row)
  const dataRow = page
    .locator(".yui3-datatable-data tr:not(.yui3-datatable-message-row) td")
    .first();

  try {
    // Wait up to 15 seconds for actual data to appear
    await dataRow.waitFor({ state: "visible", timeout: 15000 });
    console.log("✅ Data loaded successfully.");
  } catch (e) {
    const message = await page
      .locator(".yui3-datatable-message-content")
      .innerText();
    console.log(`⚠️ Search finished with message: ${message.trim()}`);
    return;
  }

  // 4. Extract and Display Results
  const rows = page.locator(
    ".yui3-datatable-data tr:not(.yui3-datatable-message-row)",
  );
  const count = await rows.count();

  console.log(`\nFound ${count} records:\n`);
  console.log(
    `${"Registration".padEnd(15)} | ${"Full Name".padEnd(30)} | ${"City".padEnd(15)} | ${"Status"}`,
  );
  console.log("-".repeat(80));

  for (let i = 0; i < count; i++) {
    const cells = rows.nth(i).locator("td");

    // Column indices for HPCSA: 2: Name, 3: Reg No, 4: City, 6: Status
    const name = await cells.nth(2).innerText();
    const reg = await cells.nth(3).innerText();
    const city = await cells.nth(4).innerText();
    const status = await cells.nth(6).innerText();

    console.log(
      `${reg.trim().padEnd(15)} | ` +
        `${name.trim().padEnd(30)} | ` +
        `${city.trim().replace(/\n/g, " ").padEnd(15)} | ` +
        `${status.trim()}`,
    );
  }
});
