using Microsoft.Playwright;
using System;
using System.Threading.Tasks;

        using var playwright = await Playwright.CreateAsync();
        await using var browser = await playwright.Chromium.LaunchAsync(new() { Headless = true });
        var context = await browser.NewContextAsync(new() { IgnoreHTTPSErrors = true });
        var page = await context.NewPageAsync();

        await page.GotoAsync("https://hpcsaonline.custhelp.com/app/i_reg_form");

        // 1. Perform the search using a partial ID selector to avoid the dynamic "27"
        // await page.Locator("input[id*='registrationCodeNumber']").FillAsync("MP0739766");
        await page.Locator("input[id*='registrationCodeNumber']").FillAsync("MP0518891");
        
        // Handle the "Close" overlay if it appears
        var closeBtn = page.GetByText("Close", new() { Exact = true });
        if (await closeBtn.IsVisibleAsync()) await closeBtn.ClickAsync();

        await page.GetByRole(AriaRole.Button, new() { Name = "SEARCH iREGISTER" }).ClickAsync();

        // 2. Wait for the results grid to load
        var tableContainer = page.Locator("div[id*='serialListGrid']");
        await tableContainer.WaitForAsync();
        
// 3. Wait specifically for a data cell (ignoring the "Loading" message row)
var dataRow = page.Locator(".yui3-datatable-data tr:not(.yui3-datatable-message-row) td").First;

try 
{
    // Wait up to 15 seconds for actual data to appear
    await dataRow.WaitForAsync(new() { State = WaitForSelectorState.Visible, Timeout = 15000 });
}
catch (TimeoutException)
{
    var message = await page.Locator(".yui3-datatable-message-content").InnerTextAsync();
    Console.WriteLine($"Search finished with message: {message.Trim()}");
    return;
}

// 4. Select all rows that are not the message row
var rows = page.Locator(".yui3-datatable-data tr:not(.yui3-datatable-message-row)");
int count = await rows.CountAsync();

Console.WriteLine($"\nFound {count} records:\n");
Console.WriteLine(string.Format("{0,-15} | {1,-30} | {2,-15} | {3,-10}", "Registration", "Full Name", "City", "Status"));
Console.WriteLine(new string('-', 80));

for (int i = 0; i < count; i++)
{
    var cells = rows.Nth(i).Locator("td");
    
    // Column indices for HPCSA iRegister:
    // 2: Name, 3: Reg No, 4: City, 6: Status
    string name = await cells.Nth(2).InnerTextAsync();
    string reg = await cells.Nth(3).InnerTextAsync();
    string city = await cells.Nth(4).InnerTextAsync();
    string status = await cells.Nth(6).InnerTextAsync();

    Console.WriteLine(string.Format("{0,-15} | {1,-30} | {2,-15} | {3,-10}", 
        reg.Trim(), 
        name.Trim(), 
        city.Trim().Replace("\n", " "), 
        status.Trim()));
}

await browser.CloseAsync();
