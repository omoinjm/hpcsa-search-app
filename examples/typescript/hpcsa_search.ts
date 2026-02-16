const { chromium } = require("playwright");

async function run() {
  console.log("🚀 Script is starting...");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    console.log("🌐 Navigating to HPCSA...");
    await page.goto("https://hpcsaonline.custhelp.com/app/i_reg_form");

    console.log("⌨️ Filling Registration Number...");
    const input = page.locator("input[id*='registrationCodeNumber']");
    await input.fill("MP0518891");

    console.log("🔍 Clicking Search...");
    await page.getByRole("button", { name: "SEARCH iREGISTER" }).click();

    console.log("⏳ Waiting for results...");
    const table = page.locator(".yui3-datatable-data");
    await table.waitFor({ state: "visible", timeout: 30000 });

    const results = await table.innerText();
    console.log("\n📊 Results Found:");
    console.log(results);
  } catch (err) {
    console.error("🛑 Error:", err);
  } finally {
    await browser.close();
    console.log("🏁 Browser closed.");
  }
}

run();
