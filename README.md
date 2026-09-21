# Activation & Follow-up — Performance Ops Console

Static client-side ops console for building the daily performance report from four uploaded sources plus the optional Google Sheet `Str` mapping sync.

## Files

```text
index.html                    App shell and toolbar
app.js                        Parsing, formula translation, report generation, rendering
style.css                     Main dark ops-console styling
theme.css                     Light/dark toggle styling
sample-data/STR-Loss-template.csv
```

## Required inputs

Upload each source as CSV or XLSX:

1. **Compensation Log**
   - `Comp_ID`
   - `Comp_Da`
   - `Comp_Du`
2. **IR Tickets File**
   - `added_by`
   - `added_on`
   - `assigned_to`
   - `IR_L_E`
3. **UTL Logs**
   - `UL_lo`
   - `UL_Date`
   - `Hold Time`
   - `Other Time`
   - `AUXOUTOFFTIME`
   - `ACWOUTOFFTIME`
   - Optional fallback: `UL_T`
4. **Structure Master Sheet / STR Loss**
   - `ST_ID`
   - `ST_Du`
   - `ST_D`
   - `TL_Name`
   - `TTS_User`
   - `Agent_Name`
   - `Login_ID`
   - `Teleopti_ID`
   - `Status`
   - `Group`

Use `sample-data/STR-Loss-template.csv` as the template for the new STR Loss upload. It contains the exact headers expected by the app.

## Date handling

The report scans **all uploaded sources** and derives the report range from the **earliest date to the latest date found** across:

- Compensation Log
- IR Tickets File
- UTL Logs
- Structure Master Sheet / STR Loss

Every day in that inclusive range becomes a report day in the UI, even if some middle dates have no rows in one or more files.

## Mapping behavior

- **STR Loss upload wins** for row metadata like TL name, TTS user, Agent name, Login ID, Teleopti ID, Status, and Group.
- The Google Sheet `Str` sync is still supported and fills Group / Leader mapping when STR Loss data is missing.
- If neither source maps an agent, the app keeps the row under `Unmapped`.

## Excel formulas translated in `app.js`

- `Assigning Tkts = COUNTIFS(assigned_to, agentId, Date, currentDate)`
- `TKT = COUNTIFS(IR_L_E, agentId, Date, currentDate)`
- `System = TKT * 0.00104166666666667`
- `Talk Time = SUMIFS(UL_T, UL_lo, loginId, UL_Date, currentDate) / 3600 / 24`

For UTL uploads, `UL_T` is derived per row from `Hold Time + Other Time + AUXOUTOFFTIME + ACWOUTOFFTIME` when those raw columns are present, matching the business rule from the legacy workbook.
- `Tele-SCH = SUMIFS(ST_Du, ST_ID, agentId, ST_D, currentDate) * 0.9`
- `Comp = SUMIFS(Comp_Du, Comp_ID, agentId, Comp_Da, currentDate)`
- `Loss Time = IF(Status <> "Active", Status, MAX(0, Tele-SCH - (Comp + Talk Time + System)))`

Duration outputs render as `H:MM:SS`.

## Running

There is no build step or package install. Open `index.html` locally or publish the repository through GitHub Pages.
