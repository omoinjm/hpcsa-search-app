import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

export interface BatchSearchResult {
  registration: string;
  name: string;
  city: string;
  status: string;
  found: boolean;
}

export interface BatchSearchResponse {
  results: BatchSearchResult[];
  activeCount: number;
  inactiveCount: number;
  notFoundCount: number;
  totalProcessed: number;
}

interface HPCSAApiResponse {
  data: any[][];
  headers: any[];
  error: string | null;
}

const HPCSA_API_URL =
  process.env.HPCSA_API_URL ||
  "https://hpcsaonline.custhelp.com/cc/ReportController/getDataFromRnow";
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || "20", 10);
const MAX_CONCURRENT_REQUESTS = parseInt(
  process.env.MAX_CONCURRENT_REQUESTS || "10",
  10
);
const REQUEST_DELAY_MS = parseInt(process.env.REQUEST_DELAY_MS || "100", 10);
const REQUEST_TIMEOUT_MS = parseInt(
  process.env.REQUEST_TIMEOUT_MS || "10000",
  10
);
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || "3", 10);

async function searchRegistration(
  registrationNumber: string,
  retryCount = 0
): Promise<BatchSearchResult> {
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
      return {
        registration: registrationNumber,
        name: "",
        city: "",
        status: "",
        found: false,
      };
    }

    // Parse the first result
    // Data columns: 0:Title, 1:Surname, 2:Fullname, 3:Registration, 4:City, 5:PostalCode, 6:Category, 7:Status
    const row = result.data[0];
    return {
      registration: row[3] || registrationNumber,
      name: `${row[0] || ""} ${row[1] || ""} ${row[2] || ""}`.trim(),
      city: row[4] || "",
      status: row[7] || "",
      found: true,
    };
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
    return {
      registration: registrationNumber,
      name: "",
      city: "",
      status: "",
      found: false,
    };
  }
}

async function processBatch(
  registrations: string[],
  onProgress?: (completed: number, total: number) => void
): Promise<BatchSearchResult[]> {
  const results: BatchSearchResult[] = [];

  for (let i = 0; i < registrations.length; i += MAX_CONCURRENT_REQUESTS) {
    const batch = registrations.slice(i, i + MAX_CONCURRENT_REQUESTS);
    console.log(
      `Processing batch ${Math.floor(i / MAX_CONCURRENT_REQUESTS) + 1}/${Math.ceil(registrations.length / MAX_CONCURRENT_REQUESTS)}: ${batch.length} registrations`
    );

    const batchResults = await Promise.all(
      batch.map((reg) => searchRegistration(reg))
    );

    results.push(...batchResults);

    if (onProgress) {
      onProgress(Math.min(i + MAX_CONCURRENT_REQUESTS, registrations.length), registrations.length);
    }

    // Small delay between batches to avoid rate limiting
    if (i + MAX_CONCURRENT_REQUESTS < registrations.length) {
      await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS));
    }
  }

  return results;
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file") as File;

  if (!file) {
    return NextResponse.json(
      { error: "No file uploaded" },
      { status: 400 }
    );
  }

  try {
    // Parse Excel file
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: "array" });

    // Get first sheet
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    // Convert to JSON
    const data: any[] = XLSX.utils.sheet_to_json(worksheet);

    // Extract registration numbers - try multiple field names
    const registrationNumbers: string[] = [];

    for (const row of data) {
      // Try different possible field names for registration
      const regNumber =
        row["Registration"] ||
        row["registration"] ||
        row["RegistrationNumber"] ||
        row["registrationNumber"] ||
        row["RegNo"] ||
        row["regNo"] ||
        row["Reg Number"] ||
        row["reg number"] ||
        row["Registration Number"] ||
        row["Registration number"];

      if (regNumber) {
        // Convert to string and trim
        const regStr = String(regNumber).trim();
        if (regStr && !registrationNumbers.includes(regStr)) {
          registrationNumbers.push(regStr);
        }
      }
    }

    if (registrationNumbers.length === 0) {
      return NextResponse.json(
        { error: "No registration numbers found in the file" },
        { status: 400 }
      );
    }

    console.log(
      `Starting batch processing of ${registrationNumbers.length} registrations (batch size: ${BATCH_SIZE}, concurrent requests: ${MAX_CONCURRENT_REQUESTS})`
    );

    const results = await processBatch(registrationNumbers);

    // Calculate statistics
    const activeCount = results.filter(
      (r) => r.found && r.status.toLowerCase() === "active"
    ).length;
    const inactiveCount = results.filter(
      (r) => r.found && r.status.toLowerCase() !== "active"
    ).length;
    const notFoundCount = results.filter((r) => !r.found).length;

    const response: BatchSearchResponse = {
      results,
      activeCount,
      inactiveCount,
      notFoundCount,
      totalProcessed: results.length,
    };

    console.log(
      `Batch processing complete: ${results.length} results (${activeCount} active, ${inactiveCount} inactive, ${notFoundCount} not found)`
    );

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error processing Excel file:", error);
    return NextResponse.json(
      { error: "Failed to process Excel file", details: String(error) },
      { status: 500 }
    );
  }
}
