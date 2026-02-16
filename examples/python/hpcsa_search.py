from playwright.sync_api import Playwright, sync_playwright, expect, TimeoutError


def run(playwright: Playwright) -> None:
    # Launch browser and context
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(ignore_https_errors=True)
    page = context.new_page()

    # Navigate to the registration form
    page.goto("https://hpcsaonline.custhelp.com/app/i_reg_form")

    # 1. Perform the search using partial ID selector
    # This avoids issues if the "27" in the ID changes dynamically
    registration_input = page.locator("input[id*='registrationCodeNumber']")
    registration_input.fill("MP0518891")

    # Handle the "Close" overlay if it appears
    close_btn = page.get_by_text("Close", exact=True)
    if close_btn.is_visible():
        close_btn.click()

    page.get_by_role("button", name="SEARCH iREGISTER").click()

    # 2. Wait for the results grid to load
    table_container = page.locator("div[id*='serialListGrid']")
    table_container.wait_for()

    # 3. Wait specifically for a data cell (ignoring "Loading" message row)
    data_row = page.locator(
        ".yui3-datatable-data tr:not(.yui3-datatable-message-row) td"
    ).first

    try:
        # Wait up to 15 seconds for actual data to appear
        data_row.wait_for(state="visible", timeout=15000)
    except TimeoutError:
        message = page.locator(".yui3-datatable-message-content").inner_text()
        print(f"Search finished with message: {message.strip()}")
        context.close()
        browser.close()
        return

    # 4. Select all rows that are not the message row
    rows = page.locator(".yui3-datatable-data tr:not(.yui3-datatable-message-row)")
    count = rows.count()

    print(f"\nFound {count} records:\n")
    print(f"{'Registration':<15} | {'Full Name':<30} | {'City':<15} | {'Status':<10}")
    print("-" * 80)

    for i in range(count):
        cells = rows.nth(i).locator("td")

        # Column indices: 2: Name, 3: Reg No, 4: City, 6: Status
        name = cells.nth(2).inner_text()
        reg = cells.nth(3).inner_text()
        city = cells.nth(4).inner_text()
        status = cells.nth(6).inner_text()

        print(
            f"{reg.strip():<15} | {name.strip():<30} | {city.strip().replace('\n', ' '):<15} | {status.strip():<10}"
        )

    # Clean up
    context.close()
    browser.close()


if __name__ == "__main__":
    with sync_playwright() as playwright:
        run(playwright)
