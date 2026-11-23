# n8n-nodes-converter-studio

This is an n8n community node. It lets you use [Converter Studio](https://converter.studio) in your n8n workflows.

Converter Studio converts files: video, audio, images, PDFs, documents, e-books, subtitles, data and archives, 67 formats in all. The node sends a file from your workflow (or a link to one) to the [Converter Studio API](https://converter.studio/developers), waits for the result and puts the converted file back into the workflow as binary data.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

[Installation](#installation) ·
[Operations](#operations) ·
[Credentials](#credentials) ·
[Usage](#usage) ·
[Example workflows](#example-workflows) ·
[Compatibility](#compatibility) ·
[Resources](#resources) ·
[Version history](#version-history)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation and install the package `n8n-nodes-converter-studio`. On a self-hosted n8n: **Settings > Community Nodes > Install**, then enter `n8n-nodes-converter-studio`.

## Operations

| Resource   | Operation | What it does                                                                                                                                 |
| ---------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| File       | Convert   | Converts a binary file of the input item, or a file at a URL, to another format. Waits for the result and downloads it into the output item. |
| Conversion | Get       | Gets a conversion by ID: its status, price and result link. Can wait for it and download the result.                                         |
| Conversion | Confirm   | Starts a conversion that was quoted because it costs more than its max credits. Can wait for it and download the result.                     |
| Account    | Get       | Gets the plan of the account, the credits left and the largest file it can convert.                                                          |
| Format     | Get Many  | Lists the formats and what each converts to (optionally only one source format).                                                             |

## Credentials

You need a Converter Studio account and an API key:

1. Sign in at [converter.studio](https://converter.studio) (a free account works; it gets 13 credits a day).
2. Open your [account page](https://converter.studio/account#api-keys) and create an API key. Keys start with `cvs_live_` and are shown once.
3. In n8n, create a **Converter Studio API** credential and paste the key into **API Key**. Leave **Base URL** as it is (`https://converter.studio/api`); change it only to test against another Converter Studio server.

n8n tests the credential by reading your account (`GET /v1/account`).

Every conversion uses the account's credits, the same as on the website. Most files cost 1 credit. Audio and video are priced once Converter Studio has measured them: by their length, and video also by its frame size and the format made (WebM costs several times as much as MP4; a video whose picture is only copied into another container costs like audio). The price is in `credits` before anything is charged, and **Max Credits** decides whether a conversion starts on its own. The [pricing page](https://converter.studio/pricing) has a price estimator.

## Usage

### Convert a file

1. Add **Converter Studio** after a node that outputs a file (for example **Read/Write Files from Disk**, **HTTP Request** with a file response, **Gmail** attachments or a **Form** upload).
2. Choose **File > Convert**.
3. **Source**: **Binary File** reads the file from **Input Binary Field** (`data` by default). **URL** lets Converter Studio download the file itself from **File URL**: a direct link, or a share link of Google Drive, Dropbox or OneDrive that anyone with the link can open.
4. **Target Format**: the list shows every target format; for a URL with a file extension it shows only what that format converts to. You can also set it with an expression, for example `{{ $json.format }}` (`pdf`, `mp4`, `jpg`, …). If a binary file's format can't become the target, the node says what it converts to instead, before anything is charged.
5. The output item has the conversion in its JSON and the converted file in **Put Output File in Field** (`data` by default).

The output JSON (with **Simplify** on) has `id`, `status`, `from`, `to`, `credits`, `outputName`, `outputSize`, `downloadUrl`, `expiresAt` and `error`. Turn **Simplify** off for the full answer of the API. The `downloadUrl` works for anyone who has it until `expiresAt`: results are kept for 6 hours.

### Price limit and quotes

**Max Credits** (default 20) is the most a conversion may cost to start on its own. A conversion that costs more is _quoted_ and waits. **Above Max Credits** decides what the node does then:

- **Fail the Item** (default): the item stops with a message that says the price.
- **Return Quote**: the node outputs the conversion with `status: quoted` and its price in `credits`. Start it later with **Conversion > Confirm** and its `id`, for example after an approval step.

Max Credits `0` only gets the price of every file.

### Waiting

With **Wait for Completion** on (default for Convert and Confirm), the node waits until the conversion is done. Each status check waits on Converter Studio until something changes, so a finished conversion is seen at once. **Options > Timeout (Seconds)** (default 600) limits the wait; after it the node stops with a message that names the conversion, which goes on at Converter Studio. Get it later with **Conversion > Get**. **Options > Polling Interval (Seconds)** (default 2) is the shortest time between two checks.

With **Wait for Completion** off, the node outputs the conversion as it is right away. **Options > Callback URL** then lets Converter Studio tell another workflow when the conversion is finished (see below).

#### n8n's execution time limit

n8n can stop a whole execution after a time limit, and that limit wins over **Timeout (Seconds)**. On n8n Cloud the plan sets it: on 2026-11-22, n8n's pricing page listed 5 minutes for Starter, 40 minutes for Pro and Enterprise, and 3 minutes for the trial. Self-hosted n8n has one only if it is set (`EXECUTIONS_TIMEOUT`, or the workflow's own timeout setting).

A long video can take longer than that: a 4-minute 1080p video took about 4.5 minutes from upload to WebM on a test server. If n8n stops the execution while the node waits, the node says so and names the conversion's ID; the conversion goes on at Converter Studio and uses its credits. A **Wait** node doesn't help: n8n counts the time an execution spends waiting toward its limit. For long conversions, use two workflows, so that no execution has to wait:

1. **Workflow B** receives the result. Start it with a **Webhook** node: HTTP Method `POST`, Respond `Immediately`. Add **Converter Studio, Conversion > Get** with Conversion ID `{{ $json.body.conversion.id }}`, **Wait for Completion** off and **Download Result** on, then what to do with the file (for example an upload to Google Drive). Publish (activate) the workflow and copy the Webhook node's **Production URL**.
2. **Workflow A** starts the conversion: **File > Convert** with **Wait for Completion** off and **Options > Callback URL** set to that Production URL. It outputs the conversion's `id` within seconds and ends.

Converter Studio sends one `POST` to the Callback URL when the conversion ends (`conversion.done`, `conversion.failed` or `conversion.canceled`), and one before that if it waits for a go-ahead because it costs more than **Max Credits** (`conversion.quoted`). The body is `{ "event", "id", "createdAt", "conversion" }`, where `conversion` is what **Conversion > Get** outputs with **Simplify** off. The request isn't signed: take it as a hint that something happened, never as the result. **Conversion > Get** with your API key is the truth: it only finds conversions of your own account, it gives the real status, and its download link is the one to use. Check its `status` (for example with an **If** node) before using the file: `done` comes with the file, `failed` with an `error`, `quoted` waits for **Conversion > Confirm**.

The Callback URL must start with `https://` and be reachable from the internet (Converter Studio doesn't call local or private addresses), so on a self-hosted n8n it needs a public address (n8n's `WEBHOOK_URL`). Keep the URL to yourself: anyone who has it can start workflow B (which then only gets what Get gives your key). Converter Studio tries again if workflow B can't be reached, doesn't answer within 10 seconds or answers 408, 429 or 5xx, up to 5 times in about an hour; a repeated request has the same `Webhook-Id` header, and running Get twice does no harm. Any other answer ends it, such as n8n's 404 when workflow B isn't published: the conversion still finishes, and **Conversion > Get** with its ID gets it.

If a Webhook is not an option, a second workflow on a **Schedule Trigger** works too: keep the `id` from workflow A (for example in a Data Table), and every few minutes run **Conversion > Get** with the kept IDs, **Wait for Completion** off and **Download Result** on. A finished conversion comes with its file; one that isn't finished yet comes with its `status`, to try again on the next run.

Results are kept for 6 hours.

### Large files

The node checks the size against the plan's limit before it sends anything. Files up to 95 MB go in one request; larger files go up in parts of 95 MB, streamed from n8n's binary data store when n8n keeps the file on disk. The largest file depends on the plan (see **Account > Get**, `maxFileBytes`).

### Conversion options

**Conversion Options** holds the settings of a conversion: quality, video height, frame rate, MP4 size limit, mute, audio bitrate, channels, sample rate, loudness, fade, trim start, image size, fit, rotation, background color, metadata, lossless WebP/AVIF, JPG/WebP/AVIF size limit, GIF width, frame rate and start, PDF compression, DPI, page range, PDF/A, text recognition and its language, CSV delimiter and encoding, spreadsheet sheet, archive password, and e-book title and author. Each option's description says which conversions it applies to; Converter Studio skips the options that don't apply.

**Other Options (JSON)** takes the API's other settings by name, as a JSON object, for example `{"vbr": "high"}`:

| Name            | Values                                                                    | Applies to                                                                 |
| --------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `purpose`       | `recommended`, `best`, `whatsapp`, `email`, `discord`, `social`, `custom` | MP4 (recorded with the job; send the settings it stands for too)           |
| `copyVideo`     | `true`, `false`                                                           | Video: copy the picture as it is when the target can hold it               |
| `soundPurpose`  | `standard`, `music`, `voice`, `smallest`                                  | Lossy sound (recorded with the job)                                        |
| `vbr`           | `high`, `medium`, `low`                                                   | MP3 and OGG: variable bitrate instead of `bitrate`                         |
| `bitDepth`      | `16`, `24`, `32`                                                          | WAV, AIFF, FLAC (32 only for WAV)                                          |
| `copyAudio`     | `true`, `false`                                                           | Sound taken from a video: keep it as it is when the target holds its codec |
| `width`         | `2560`, `1920`, `1280`, `800`                                             | Images: the width at most                                                  |
| `longSide`      | `2560`, `1920`, `1280`, `800`                                             | Images: the longer side at most                                            |
| `scale`         | `75`, `50`, `25`                                                          | Images: this percentage of the size                                        |
| `keepLocation`  | `true`, `false`                                                           | Images, with `keepMetadata`: keep the GPS location too                     |
| `iconSize`      | `favicon`, `256`, `128`, `64`, `48`, `32`, `16`                           | ICO                                                                        |
| `flip`          | `true`, `false`                                                           | Images: mirror left to right                                               |
| `svgScale`      | `1`, `2`, `4`                                                             | SVG to a picture: times its own size                                       |
| `sheetsOnePage` | `true`, `false`                                                           | Spreadsheets to PDF: each sheet on one page                                |
| `header`        | `true`, `false`                                                           | CSV to JSON, XML or YAML: the first row holds the field names              |
| `archiveLevel`  | `fast`, `normal`, `smallest`                                              | ZIP, 7Z and TAR.GZ written                                                 |
| `ebookReader`   | `generic`, `kindle`, `kobo`, `tablet`                                     | EPUB, MOBI, AZW3 written                                                   |
| `paperSize`     | `a4`, `a5`, `letter`, `phone`                                             | E-books to PDF                                                             |
| `textSize`      | `small`, `medium`, `large`                                                | E-books to PDF                                                             |
| `margins`       | `narrow`, `normal`, `wide`                                                | E-books to PDF                                                             |
| `tocPage`       | `true`, `false`                                                           | E-books to PDF: a contents page                                            |
| `slideLayout`   | `slides`, `notes`, `handout`                                              | Slides to PDF                                                              |
| `handoutSlides` | `2`, `3`, `4`, `6`, `9`                                                   | Slides to PDF as handouts                                                  |
| `hiddenSlides`  | `true`, `false`                                                           | Slides to PDF: hidden slides too                                           |
| `subtitleShift` | seconds, -3600 to 3600                                                    | Subtitles: every line later (or earlier)                                   |
| `subtitleFps`   | `23.976-25`, `25-23.976`, `24-25`, `25-24`                                | Subtitles: re-timed for another frame rate                                 |
| `fontSubset`    | `all`, `latin`, `latinCyrillic`                                           | WOFF and WOFF2                                                             |
| `jsonIndent`    | `2`, `4`, `compact`                                                       | JSON written                                                               |
| `nested`        | `columns`, `json`                                                         | JSON, XML, YAML to CSV or Excel                                            |

A typed option wins over the same name in the JSON. A name the API doesn't know stops the item with a message.

### Errors and limits

Messages come from Converter Studio in plain words (for example _"This needs 3 credits and you have 1."_), with what to do next below them. With **Settings > On Error > Continue**, a failed item outputs `error` (the message) and `details`: `code` (the API's error code, such as `notEnoughCredits`, `fileTooLarge`, `unsupportedConversion`, `quoted` or `timeout`) and `conversionId` when there is one, for example `{{ $json.details.conversionId }}`. With **Continue (using error output)**, those items go to the node's error output, with the fields of the input item, and the others to its success output.

The API takes 60 requests a minute per API key for most calls. The node waits out a rate limit (HTTP 429, using `Retry-After`) and a busy server (HTTP 503) and tries again, up to three times. For hundreds of files, use the **Loop Over Items** node with a small batch size.

### Retries

**File > Convert** sends an `Idempotency-Key` with each conversion it starts, made from n8n's execution ID, the node, the node's run and the item. Converter Studio answers a request with a key it has seen in the last 24 hours with the conversion that key started, and charges nothing again. So:

- **Settings > Retry On Fail** runs the node again in the same execution, and each item gets the conversion of the try before, with no second upload and no second charge: after a lost connection, or after **Timeout (Seconds)**, the retry picks up the conversion where it is. If that conversion failed or was canceled, the retry starts a new one (a failed conversion costs nothing).
- A new execution makes new conversions: running the workflow again, **Execute step**, and **Retry** of a failed execution in the executions list (that is a new execution in n8n). To pick up a conversion of an earlier execution instead, use **Conversion > Get** with its ID; the error of a stopped wait names it.
- A node that runs several times in one execution (in a loop, or as an AI agent's tool) starts a new conversion each time.

When n8n has no execution ID (for example when the node runs as a tool of an MCP Server Trigger), the node sends no key, and a lost connection is not retried.

### As an AI agent tool

The node can be used as a tool of the AI Agent node. Converting from a URL works best there, since the agent gets the `downloadUrl` of the result.

## Example workflows

**Email attachments to PDF.** Gmail Trigger (download attachments) → Converter Studio, File > Convert, Source: Binary File, Input Binary Field `attachment_0`, Target Format `pdf` → Google Drive, Upload, the `data` field.

**Photos from a form to WebP.** n8n Form Trigger with a file field → Converter Studio, File > Convert, Target Format `webp`, Conversion Options > Quality `balanced`, Max File Size (KB) `300` → Read/Write Files from Disk, or an S3 upload.

**Approve expensive video conversions.** Converter Studio, File > Convert, Max Credits `5`, Above Max Credits **Return Quote** → If `{{ $json.status }}` is `quoted` → Send and Wait for an approval (Slack, email) → Converter Studio, Conversion > Confirm, Conversion ID `{{ $('Converter Studio').item.json.id }}`.

**Long videos without a waiting execution.** Workflow A: Converter Studio, File > Convert, Wait for Completion off, Options > Callback URL = the Production URL of workflow B's Webhook node. Workflow B: Webhook (POST) → Converter Studio, Conversion > Get, Conversion ID `{{ $json.body.conversion.id }}`, Download Result on → If `{{ $json.status }}` is `done` → Google Drive, Upload (see [n8n's execution time limit](#n8ns-execution-time-limit)).

## Compatibility

Built with n8n's node CLI (`@n8n/node-cli` 0.57). Tested in a running self-hosted n8n 2.48.7, installed from the packed package the way Community Nodes installs it: the node picker, the credential test, the option lists, use as an AI Agent tool, and executions of every operation, with n8n's binary data on disk, in the database and in memory (a 119 MB file went up in two parts). Also tried there: the Callback URL recipe (a 40-second 1080p video to WebM; workflow A ended at once, workflow B's Webhook was called about 50 seconds later and Conversion > Get downloaded the 32 MB result), and Retry On Fail (a 10-second timeout on the same video: four tries, one upload, one conversion, the last three answered as repeats). The package has no runtime dependencies.

## Privacy

Files go to Converter Studio only to be converted. Uploads are deleted once converted, results after 6 hours. See the [privacy policy](https://converter.studio/privacy) and the [terms](https://converter.studio/terms).

## Development and releases

```sh
npm ci
npm run lint
npm test                 # builds, then unit tests with a mocked API (no network, no API key)
```

Releases are published to npm by this repository's GitHub Actions workflow (`.github/workflows/publish.yml`) when a version tag is pushed, with an [npm provenance statement](https://docs.npmjs.com/generating-provenance-statements): the package page on npm shows the commit and the workflow each version was built from.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [Converter Studio API and MCP server](https://converter.studio/developers)
- Support: [support@converter.studio](mailto:support@converter.studio), or [open an issue](https://github.com/tariksucu/n8n-nodes-converter-studio/issues)

## Version history

### 0.1.0

First release: File > Convert (binary file or URL, waiting, download, quotes, parts for large files, conversion options, Callback URL, an Idempotency-Key so Retry On Fail gets the same conversion), Conversion > Get and Confirm, Account > Get, Format > Get Many.

## License

[MIT](LICENSE)
