# Changelog

## 0.1.0

First release.

- File > Convert: a binary file of the input item or a file at a URL, to any of the target formats Converter Studio offers for it; waits for the result and downloads it into binary data; Max Credits with "Fail the Item" or "Return Quote"; uploads in parts of 95 MB for large files; typed conversion options plus "Other Options (JSON)".
- File > Convert sends an Idempotency-Key made from the execution, the node, its run and the item: Retry On Fail gets the conversion of the try before (no second upload, no second charge), and starts a new one only after a failed or canceled conversion.
- File > Convert, without waiting: Options > Callback URL, for a second workflow that starts on a Webhook when the conversion ends.
- Conversion > Get and Conversion > Confirm, with waiting and download.
- Account > Get and Format > Get Many.
- Converter Studio API credential (API key, base URL) tested against GET /v1/account.
