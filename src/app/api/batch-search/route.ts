/**
 * Batch Search API Route
 * Uses service layer for separation of concerns
 * Single Responsibility: Only handles HTTP request/response
 * Dependency Inversion: Uses service container for all dependencies
 */

import { NextResponse } from "next/server";
import {
  getServiceContainer,
  BatchSearchResult as ServiceBatchSearchResult,
} from "@/lib/services";

// API-specific response interface with metadata
export interface BatchSearchResult extends ServiceBatchSearchResult {
  professionalCouncilName?: string;
  timeInSession?: string;
}

export interface BatchSearchResponse {
  results: BatchSearchResult[];
  activeCount: number;
  inactiveCount: number;
  notFoundCount: number;
  totalProcessed: number;
}

/**
 * Handle batch search POST request
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;

    // Validation: Check file exists
    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    // Get services from container (Dependency Injection via container)
    const container = getServiceContainer();
    const fileParserRegistry = container.getFileParserRegistry();
    const fileTypeDetector = container.getFileTypeDetector();
    const registrationExtractor = container.getRegistrationExtractor();
    const errorFormatter = container.getRegistrationExtractorErrorFormatter();
    const batchProcessor = container.getBatchProcessor();

    // Validate file type
    if (!fileParserRegistry.isSupported(file.name)) {
      return NextResponse.json(
        {
          error: "Unsupported file type. Supported formats: .csv, .xlsx, .xls",
        },
        { status: 400 },
      );
    }

    // Get file type and parser
    const fileType = fileTypeDetector.detect(file.name);
    if (fileType === "unknown") {
      return NextResponse.json(
        { error: "Unable to determine file type" },
        { status: 400 },
      );
    }

    const parser = fileParserRegistry.getParserForFile(file.name);
    if (!parser) {
      return NextResponse.json(
        { error: `No parser available for ${fileType} files` },
        { status: 400 },
      );
    }

    // Step 1: Parse file
    const arrayBuffer = await file.arrayBuffer();
    const parseResult = await parser.parse(arrayBuffer);

    console.log(`Parsed ${parseResult.data.length} rows from file`);
    if (parseResult.data.length > 0) {
      console.log(
        "Sample row keys:",
        Object.keys(parseResult.data[0]).slice(0, 10),
      );
    }

    // Step 2: Extract registration numbers and build lookup map
    const extractResult = registrationExtractor.extract(parseResult.data, {
      fileType,
    });

    // Build a map of registration numbers to original row data
    const originalDataMap = new Map<
      string,
      { professionalCouncilName?: string; timeInSession?: string }
    >();

    // Flexible field name matching (case-insensitive)
    const getFieldValue = (
      row: Record<string, unknown>,
      possibleFields: string[],
    ): unknown => {
      for (const [key, value] of Object.entries(row)) {
        const normalizedKey = key.trim().toLowerCase();
        for (const field of possibleFields) {
          if (
            normalizedKey === field.toLowerCase() &&
            value !== undefined &&
            value !== null &&
            value !== ""
          ) {
            return value;
          }
        }
      }
      return undefined;
    };

    const councilNameFields = ["Professional council name", "Council Name"];
    const timeInSessionFields = [
      "Time in Session (minutes)",
      "Time in Session",
      "Duration",
    ];
    const regFields =
      fileType === "csv"
        ? ["Professional council number", "Council Number"]
        : ["Registration number", "Registration"];

    for (const row of parseResult.data as Record<string, unknown>[]) {
      // Get registration number using flexible matching
      const regNumber = getFieldValue(row, regFields);

      if (regNumber) {
        // Normalize registration number: remove all spaces
        const regStr = String(regNumber).trim().replace(/\s+/g, "");

        // Get professional council name using flexible matching
        const councilName = getFieldValue(row, councilNameFields);

        // Get time in session using flexible matching
        const timeInSession = getFieldValue(row, timeInSessionFields);

        originalDataMap.set(regStr, {
          professionalCouncilName: councilName
            ? String(councilName)
            : undefined,
          timeInSession:
            timeInSession !== undefined ? String(timeInSession) : undefined,
        });
      }
    }

    console.log(`Built lookup map with ${originalDataMap.size} entries`);
    // Debug: Log first few entries
    const firstFew = Array.from(originalDataMap.entries()).slice(0, 3);
    console.log("Sample lookup entries:", firstFew);

    // Validation: Check registration numbers found
    if (extractResult.registrationNumbers.length === 0) {
      return NextResponse.json(
        {
          error: errorFormatter.getErrorMessage(
            fileType,
            extractResult.skippedCount,
            extractResult.totalRows,
          ),
          details: {
            totalRows: extractResult.totalRows,
            skipped: extractResult.skippedCount,
          },
        },
        { status: 400 },
      );
    }

    // Step 3: Process batch
    const serviceResponse = await batchProcessor.process(
      extractResult.registrationNumbers,
    );

    // Map service response to API response format with original CSV data
    const resultsWithMetadata = serviceResponse.results.map((result) => {
      const originalData = originalDataMap.get(result.registration);
      console.log(`Mapping result for ${result.registration}:`, originalData);
      return {
        ...result,
        professionalCouncilName: originalData?.professionalCouncilName,
        timeInSession: originalData?.timeInSession,
      };
    });

    const apiResponse: BatchSearchResponse = {
      results: resultsWithMetadata,
      activeCount: serviceResponse.statistics.activeCount,
      inactiveCount: serviceResponse.statistics.inactiveCount,
      notFoundCount: serviceResponse.statistics.notFoundCount,
      totalProcessed: serviceResponse.statistics.totalProcessed,
    };

    console.log(
      `Returning ${apiResponse.results.length} results with metadata`,
    );

    return NextResponse.json(apiResponse);
  } catch (error) {
    console.error("Error processing batch search:", error);
    return NextResponse.json(
      {
        error: "Failed to process file",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
