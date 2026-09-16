# INSTRUMENTATION SPEC — Contract C10

The local bench sites expose these attributes as ground truth for the Playwright
evaluation harness. The extension bundle must contain **zero** occurrences of
`data-glasswall-`; extension code never reads them.

---

## Attribute Reference

| Attribute | Values | Required | Purpose |
|-----------|--------|----------|---------|
| `data-glasswall-pii` | `EMAIL \| PHONE \| AADHAAR \| PAN \| IFSC \| GSTIN \| UPI \| CARD \| DOB \| PERSON_NAME \| STREET_ADDRESS \| POSTAL_CODE \| IP \| SECRET \| MRN \| NONE` | Yes | PII type label for ground truth |
| `data-glasswall-tier` | `1 \| 2 \| 3` | Yes | Sensitivity tier (1=never in payload, 2=tokenized, 3=generalized) |
| `data-glasswall-value-id` | `v_<number>` (e.g., `v_17`) | Yes | **Referential consistency key** — SAME value in shipping and billing gets the SAME id |
| `data-glasswall-decoy` | `true` | No (only on decoys) | Marks near-misses (12-digit SKU, invalid-Verhoeff, PAN-shaped product code) — measures precision, not recall |
| `data-glasswall-regions` | JSON array of `{x,y,w,h,pii,value_id}` | Only on `<canvas>` / `<img>` | Pixel PII regions in **CSS pixels relative to the element box** |

---

## PII Type Enum (`data-glasswall-pii`)

```
EMAIL | PHONE | AADHAAR | PAN | IFSC | GSTIN | UPI | CARD | DOB |
PERSON_NAME | STREET_ADDRESS | POSTAL_CODE | IP | SECRET | MRN | NONE
```

- `SECRET` = high-entropy API keys, tokens, passwords
- `MRN` = medical record number (ClinicDesk)
- `NONE` = explicitly marked non-PII (useful for negative controls)

---

## Tier Semantics (`data-glasswall-tier`)

| Tier | Policy Behavior | Example |
|------|-----------------|---------|
| 1 | **Never in payload** — not even as a handle. `value_state` only. | `password`, `otp`, `cc-csc` |
| 2 | **Tokenized** — `@vault:TYPE#idx` handle in payload, resolved at bind time. | `email`, `phone`, `aadhaar`, `pan`, `card` |
| 3 | **Generalized** — bucketed/redacted representation (e.g., `rahul@***`, `98***`). | `person_name`, `street_address`, `postal_code` |

---

## Referential Consistency (`data-glasswall-value-id`)

**Critical rule:** The same logical value appearing in multiple locations **must** share the same `value_id`.

```html
<!-- Shipping email -->
<input type="email" value="rahul@example.com"
       data-glasswall-pii="EMAIL" data-glasswall-tier="2" data-glasswall-value-id="v_17">

<!-- Billing email (same value) -->
<input type="email" value="rahul@example.com"
       data-glasswall-pii="EMAIL" data-glasswall-tier="2" data-glasswall-value-id="v_17">
```

This is what **proves referential consistency** in evaluation — the generator emits identical `value_id` for identical values, and the eval harness verifies the sanitized observation produces identical handles.

---

## Decoys (`data-glasswall-decoy="true"`)

Decoys are **near-misses that must NOT be detected**. They measure precision (over-detection), not recall.

| Decoy Type | Example | Why It Matters |
|------------|---------|----------------|
| 12-digit failing Verhoeff | `123456789012` | Prevents tokenizing product SKUs as Aadhaar |
| Card failing Luhn | `4111111111111111` (valid) → `4111111111111112` (invalid) | Prevents tokenizing order numbers as cards |
| PAN-shaped SKU | `ABCDE1234F` (valid PAN) → `PROD12345X` (product code) | Prevents tokenizing inventory codes as PAN |
| 6-digit non-PIN | `123456` (order number) | Prevents tokenizing order IDs as postal codes |

**Generator contract:** `generateDecoys(seed)` emits these with `data-glasswall-decoy="true"` and `data-glasswall-pii` set to the type they mimic. The eval harness asserts **zero detections** on decoys.

---

## Pixel PII — `data-glasswall-regions` (Canvas / Image)

For `<canvas>` and `<img>` elements where PII exists only in pixels (not DOM text), add a `data-glasswall-regions` attribute containing a JSON array:

```typescript
interface GlassWallRegion {
  x: number;      // CSS px from element left edge
  y: number;      // CSS px from element top edge
  w: number;      // width in CSS px
  h: number;      // height in CSS px
  pii: string;    // PII type from the enum above
  value_id: string; // matches the generator's value_id for this value
}
```

**Example — Canvas with rendered Aadhaar:**

```html
<canvas id="aadhaar-preview" width="300" height="100"
        data-glasswall-regions='[{"x":10,"y":10,"w":200,"h":30,"pii":"AADHAAR","value_id":"v_42"}]'>
</canvas>
```

**Example — Image with embedded PAN:**

```html
<img src="/generated/pan-card.png" alt="PAN card"
     data-glasswall-regions='[{"x":50,"y":80,"w":180,"h":40,"pii":"PAN","value_id":"v_99"}]'>
```

**Coordinate system:** CSS pixels relative to the element's content box (same as `getBoundingClientRect()`). Not canvas internal coordinates, not image natural pixels. The eval harness converts using the element's rendered DPR.

---

## Where Attributes Go — Element-by-Element

### 1. Labelled Input (`<input>`, `<textarea>`, `<select>`)

**On the input element itself** (not the label):

```html
<label for="email">Email</label>
<input id="email" type="email" autocomplete="email"
       value="rahul@example.com"
       data-glasswall-pii="EMAIL" data-glasswall-tier="2" data-glasswall-value-id="v_17">
```

### 2. Text Span / Inline Text (`<span>`, `<div>`, `<p>`, `<td>`)

**On the element containing the text node:**

```html
<span data-glasswall-pii="PERSON_NAME" data-glasswall-tier="3" data-glasswall-value-id="v_3">
  Rahul Sharma
</span>

<td data-glasswall-pii="AADHAAR" data-glasswall-tier="2" data-glasswall-value-id="v_42">
  1234 5678 9012
</td>
```

### 3. Table Cell (`<td>`, `<th>`)

**On the cell element:**

```html
<tr>
  <td data-glasswall-pii="STREET_ADDRESS" data-glasswall-tier="3" data-glasswall-value-id="v_8">
    123 MG Road, Bangalore
  </td>
  <td data-glasswall-pii="POSTAL_CODE" data-glasswall-tier="3" data-glasswall-value-id="v_9">
    560001
  </td>
</tr>
```

### 4. Canvas (`<canvas>`)

**On the canvas element** with `data-glasswall-regions`:

```html
<canvas id="signature-pad" width="400" height="200"
        data-glasswall-regions='[{"x":20,"y":20,"w":300,"h":80,"pii":"PERSON_NAME","value_id":"v_3"}]'>
</canvas>
```

### 5. Image (`<img>`)

**On the img element** with `data-glasswall-regions`:

```html
<img src="/receipts/invoice-17.png"
     data-glasswall-regions='[
       {"x":100,"y":150,"w":120,"h":20,"pii":"GSTIN","value_id":"v_55"},
       {"x":100,"y":180,"w":200,"h":20,"pii":"STREET_ADDRESS","value_id":"v_8"}
     ]'>
```

### 6. Free-Text Block (`<div>`, `<section>`, `<article>` with prose)

**On the block element** — the generator embeds PII in prose for NER testing:

```html
<div class="clinical-note"
     data-glasswall-pii="NONE" data-glasswall-tier="3"
     data-glasswall-value-id="v_100">
  Patient <span data-glasswall-pii="PERSON_NAME" data-glasswall-tier="3" data-glasswall-value-id="v_3">Rahul Sharma</span>
  presented with complaint. Resides at
  <span data-glasswall-pii="STREET_ADDRESS" data-glasswall-tier="3" data-glasswall-value-id="v_8">123 MG Road, Bangalore 560001</span>.
  Contact: <span data-glasswall-pii="PHONE" data-glasswall-tier="2" data-glasswall-value-id="v_12">+91 98765 43210</span>.
</div>
```

**Note:** The outer block gets `pii="NONE"` (it's a container), while inline spans carry the actual PII labels.

---

## Worked Example — Complete Form (20 Lines)

```html
<form id="checkout">
  <!-- Shipping -->
  <fieldset data-glasswall-pii="NONE">
    <legend>Shipping</legend>
    <label for="s-name">Name</label>
    <input id="s-name" autocomplete="name"
           value="Rahul Sharma"
           data-glasswall-pii="PERSON_NAME" data-glasswall-tier="3" data-glasswall-value-id="v_3">

    <label for="s-email">Email</label>
    <input id="s-email" type="email" autocomplete="email"
           value="rahul@example.com"
           data-glasswall-pii="EMAIL" data-glasswall-tier="2" data-glasswall-value-id="v_17">

    <label for="s-phone">Phone</label>
    <input id="s-phone" type="tel" autocomplete="tel"
           value="+91 98765 43210"
           data-glasswall-pii="PHONE" data-glasswall-tier="2" data-glasswall-value-id="v_12">

    <label for="s-addr">Address</label>
    <textarea id="s-addr" autocomplete="street-address"
              data-glasswall-pii="STREET_ADDRESS" data-glasswall-tier="3" data-glasswall-value-id="v_8">
      123 MG Road, Bangalore
    </textarea>

    <label for="s-pin">PIN</label>
    <input id="s-pin" autocomplete="postal-code"
           value="560001"
           data-glasswall-pii="POSTAL_CODE" data-glasswall-tier="3" data-glasswall-value-id="v_9">
  </fieldset>

  <!-- Billing (same email, same value_id = referential consistency) -->
  <fieldset data-glasswall-pii="NONE">
    <legend>Billing</legend>
    <label for="b-email">Email</label>
    <input id="b-email" type="email" autocomplete="email"
           value="rahul@example.com"
           data-glasswall-pii="EMAIL" data-glasswall-tier="2" data-glasswall-value-id="v_17">

    <label for="b-card">Card</label>
    <input id="b-card" autocomplete="cc-number"
           value="4111 1111 1111 1111"
           data-glasswall-pii="CARD" data-glasswall-tier="2" data-glasswall-value-id="v_21">

    <label for="b-cvv">CVV</label>
    <input id="b-cvv" type="password" autocomplete="cc-csc"
           value="123"
           data-glasswall-pii="SECRET" data-glasswall-tier="1" data-glasswall-value-id="v_22">

    <!-- Decoy: 12-digit SKU that fails Verhoeff -->
    <input type="hidden" id="sku" value="123456789012"
           data-glasswall-pii="AADHAAR" data-glasswall-tier="2" data-glasswall-value-id="v_999"
           data-glasswall-decoy="true">
  </fieldset>

  <!-- Canvas signature -->
  <canvas id="sig" width="300" height="100"
          data-glasswall-regions='[{"x":10,"y":10,"w":250,"h":40,"pii":"PERSON_NAME","value_id":"v_3"}]'>
  </canvas>
</form>
```

---

## Generator Integration Notes

- `generatePersona(seed)` returns an object with **every value, its type, tier, and value_id**.
- `generateDecoys(seed)` returns decoy values with `decoy: true` flag.
- `exportGroundTruth(seed)` writes `eval/fixtures/ground-truth-{seed}.json` with the complete mapping.
- **Same seed → byte-identical output** across runs, across machines, across Node and browser.
- The `value_id` format is `v_<number>` where the number is assigned sequentially by the generator per seed. Identical values get identical IDs within a seed.

---

## CI Enforcement (B Owns This Check)

```bash
# In CI: fail if extension bundle contains data-glasswall-
grep -r "data-glasswall-" apps/extension/dist/ && exit 1 || exit 0
```

This runs in `verify:boundary`. If the extension bundle has any `data-glasswall-*` attribute reference, **every evaluation number is worthless** — the extension would be reading its own ground truth.

---

## Quick Reference for A (Copy-Paste Ready)

```html
<!-- Input -->
<input ... data-glasswall-pii="EMAIL" data-glasswall-tier="2" data-glasswall-value-id="v_17">

<!-- Span -->
<span ... data-glasswall-pii="PERSON_NAME" data-glasswall-tier="3" data-glasswall-value-id="v_3">...</span>

<!-- Canvas -->
<canvas ... data-glasswall-regions='[{"x":10,"y":10,"w":200,"h":30,"pii":"AADHAAR","value_id":"v_42"}]'></canvas>

<!-- Image -->
<img ... data-glasswall-regions='[{"x":50,"y":80,"w":180,"h":40,"pii":"PAN","value_id":"v_99"}]'>

<!-- Decoy -->
<input ... data-glasswall-pii="AADHAAR" data-glasswall-tier="2" data-glasswall-value-id="v_999" data-glasswall-decoy="true">
```
