# Changelog

## 0.1.2

- README: free Converter Studio accounts get 25 credits a day (it said 13, the allowance before 2026-11-24). No change in behaviour.

## 0.1.1

- File > Convert as an AI Agent tool: with **File URL** "Defined by agent", the **Target Format** list showed "Error fetching options from Converter Studio Tool", because n8n's editor can't resolve a value the agent fills in only when it runs. The list now loads there with every target format, as it does whenever the editor can't know the file (a binary file, a link set by an expression that has no data yet, a link without a file extension); each format then says it is checked against the file when the node runs. A link written out still narrows the list to what its format converts to, as before.
- As an AI Agent tool, an error's message also carries the details under it (n8n gives the agent only the message), and a conversion the file can't make names what the file converts to, so the agent can choose again.

## 0.1.0

First release.

- File > Convert: a binary file of the input item or a file at a URL, to any of the target formats Converter Studio offers for it; waits for the result and downloads it into binary data; Max Credits with "Fail the Item" or "Return Quote"; uploads in parts of 95 MB for large files; typed conversion options plus "Other Options (JSON)".
- File > Convert sends an Idempotency-Key made from the execution, the node, its run and the item: Retry On Fail gets the conversion of the try before (no second upload, no second charge), and starts a new one only after a failed or canceled conversion.
- File > Convert, without waiting: Options > Callback URL, for a second workflow that starts on a Webhook when the conversion ends.
- Conversion > Get and Conversion > Confirm, with waiting and download.
- Account > Get and Format > Get Many.
- Converter Studio API credential (API key, base URL) tested against GET /v1/account.
