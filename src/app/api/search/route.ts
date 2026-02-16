import { NextResponse } from "next/server";

export interface HPCSAResult {
  name: string;
  registration: string;
  city: string;
  status: string;
}

interface HPCSAApiResponse {
  data: any[][];
  headers: any[];
  error: string | null;
}

const HPCSA_API_URL =
  process.env.HPCSA_API_URL ||
  "https://hpcsaonline.custhelp.com/cc/ReportController/getDataFromRnow";
const REQUEST_TIMEOUT_MS = parseInt(
  process.env.REQUEST_TIMEOUT_MS || "10000",
  10
);
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || "3", 10);

async function searchRegistration(
  registrationNumber: string,
  retryCount = 0
): Promise<HPCSAResult[]> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const response = await fetch(HPCSA_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `regNumber=${encodeURIComponent(registrationNumber)}`,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    const result: HPCSAApiResponse = await response.json();

    if (result.error) {
      throw new Error(result.error);
    }

    if (!result.data || result.data.length === 0) {
      return [];
    }

    // Parse the results
    // Data columns: 0:Title, 1:Surname, 2:Fullname, 3:Registration, 4:City, 5:PostalCode, 6:Category, 7:Status
    return result.data.map((row) => ({
      name: `${row[0] || ""} ${row[1] || ""} ${row[2] || ""}`.trim(),
      registration: row[3] || registrationNumber,
      city: row[4] || "",
      status: row[7] || "",
    }));
  } catch (error: any) {
    if (
      (error.message?.includes("abort") || error.message?.includes("timeout")) &&
      retryCount < MAX_RETRIES
    ) {
      console.log(
        `Retry ${retryCount + 1}/${MAX_RETRIES} for ${registrationNumber}`
      );
      await new Promise((resolve) =>
        setTimeout(resolve, 1000 * (retryCount + 1))
      );
      return searchRegistration(registrationNumber, retryCount + 1);
    }

    console.error(`Error searching ${registrationNumber}:`, error.message);
    return [];
  }
}

export async function POST(request: Request) {
  const { registrationNumber } = await request.json();

  if (!registrationNumber) {
    return NextResponse.json(
      { error: "Registration number is required" },
      { status: 400 }
    );
  }

  try {
    console.log(`🔍 Searching for: ${registrationNumber}`);
    const results = await searchRegistration(registrationNumber);

    if (results.length === 0) {
      return NextResponse.json({
        results: [],
        message: "No results found",
      });
    }

    console.log(`✅ Found ${results.length} record(s)`);
    return NextResponse.json({ results, message: null });
  } catch (error) {
    console.error("Error during HPCSA search:", error);
    return NextResponse.json(
      { error: "Failed to search HPCSA registration", details: String(error) },
      { status: 500 }
    );
  }
}
