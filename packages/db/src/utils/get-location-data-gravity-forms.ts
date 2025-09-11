import { GoogleSpreadsheet } from "google-spreadsheet";

export const creds = {
  private_key: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY!.replace(
    /\\\n/g,
    "\n",
  ),
  client_email: process.env.GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL!,
};

const getSheetData = async <T>(params: {
  doc: GoogleSpreadsheet;
  sheetName: string;
}) => {
  const { doc, sheetName } = params;
  const regionSheet = doc.sheetsByTitle[sheetName];
  if (!regionSheet) {
    throw new Error(`No regionSheet found`);
  }
  console.log("found regionSheet");

  await regionSheet.loadHeaderRow();
  const header = regionSheet.headerValues;
  console.log("header", header.join(","));

  const rows = await regionSheet?.getRows(); // can this use the row we just added?
  const data: T[] = [];
  for (const row of rows) {
    // for (const row of rows.slice(0, Math.floor(rows.length / 2))) {
    const obj = header.reduce((acc, key) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      acc[key as keyof T] = row[key];
      return acc;
    }, {} as T);
    data.push(obj);
  }
  return data;
};

export interface RegionSheetData {
  Sector: string;
  Area: string;
  "Region Name": string;
  "Closest Major City": string;
  Website: string;
  "Region Email": string;
  "Twitter Handle": string;
  "Nantan Email": string;
  "Weasel Shaker Email": string;
  "ComzQ Email": string;
  "ITQ Email": string;
  "Nantan Phone": string;
  "Weasel Shaker Phone": string;
  "ComzQ Phone": string;
  "ITQ Phone": string;
  Country: string;
  States: string;
  "Entry ID": string;
  Created: string;
  Updated: string;
  "Nantan First Name": string;
  "Nantan F3 Name": string;
  "Nantan Last Name": string;
  "Weasel Shaker First Name": string;
  "Weasel Shaker F3 Name": string;
  "Weasel Shaker Last Name": string;
  "ComzQ First Name": string;
  "ComzQ F3 Name": string;
  "ComzQ Last Name": string;
  "ITQ First Name": string;
  "ITQ F3 Name": string;
  "ITQ Last Name": string;
}

export interface WorkoutSheetData {
  "Workout Name": string;
  Region: string;
  Time: string;
  Type: string;
  Latitude: string;
  Longitude: string;
  Weekday: string;
  Note: string;
  Website: string;
  Logo: string;
  "Address 1": string;
  "Address 2": string;
  City: string;
  State: string;
  "Postal Code": string;
  Country: string;
  "Address Accurate?": string;
  "Stationary?": string;
  Submitter: string;
  "Submitter Email": string;
  "Entry ID": string;
  Created: string;
  Updated: string;
  "Is Approved": string;
}

export const getLocationDataFromGravityForms = async () => {
  // Initialize the sheet - doc ID is the long id in the sheets URL
  const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID_GRAVITY_FORMS);
  console.log("doc", !!doc);

  await doc.useServiceAccountAuth(creds);

  console.log("authenticated");

  await doc.loadInfo(); // loads document properties and worksheets

  const regionData = await getSheetData<RegionSheetData>({
    doc,
    sheetName: "Data - Region",
  });
  const workoutData = await getSheetData<WorkoutSheetData>({
    doc,
    sheetName: "Data - Workout",
  });

  return { regionData, workoutData };
};
