# Coretax XML fixtures — provenance (T-106, PR-98)

Public DJP documents from the "Template XML dan Converter Excel ke XML" page
(https://www.pajak.go.id/id/reformdjp/coretax/template-xml-dan-converter-excel-ke-xml), fetched 2026-11-19. They are not secrets and
contain only DJP's sample values. The tests read them to check the generated documents' element order, required elements and value
formats. No XML library is added (Panel 2 decision 1).

| File here | Source download (SHA-256 of the download) | Extracted member | SHA-256 of the file here |
|---|---|---|---|
| `faktur-pk-sample-v1.4.xml` | https://pajak.go.id/sites/default/files/2025-03/Sample%20Faktur%20PK%20Template%20v.1.4.xml.zip (`a71d6c004f7d0979b9f33eedc7f669daf3238e6820d2decd13525f2cc32b9beb`) | `Sample Faktur PK Template v.1.4.xml` (also inside `ConverterEfakturCoretax__v1.6.zip`, `ef5957af98ed06d7aee3c0fed6a67b56fe6f515bf776788194b2acd9a005b791`) | `113f44079470f8d8a2e9199d05113934c02a055be087feecf5286db6f6576f0e` |
| `retail-digunggung-sample.xml` | https://pajak.go.id/sites/default/files/2024-11/SPT%20PPN%20Digunggung.xml.zip (`423e2b402cfa760171645103071133c33707fd74c801304684931ea41219edab`) | `SPT PPN DIgunggung.xml` | `79a49a340905f7469518409ff3290146dd397ecfe4296ec4c7a94e807bac8223` |
| `retail-invoice-bulk.xsd` | https://pajak.go.id/sites/default/files/2025-10/Retail_XML%20Induk%20IA5%20IA9%20dan%20IB.xlsx (`44863a31e623e01108bb7e9d0680da1c0c4f4bc9e38cf0ec84a4a8aa8b29eef7`) | the `RetailInvoiceBulk` `xs:schema` embedded in `xl/xmlMaps.xml`, verbatim, with an XML declaration added | `ad62460c4ee404447ef05c61dcff1532837ee073152b402cc5c4409b69085a03` |
| `retur-dok-lain-keluaran-sample.xml` | https://pajak.go.id/sites/default/files/2024-11/Retur%20Dok%20Lain%20Keluaran.xml.zip (`6dde2c40e9d45f1282bfc926ce1ddcad27dcfecd1d996ba2e849675b6f606669`) | `Retur Dok Lain Keluaran.xml` | `a251a91c2124095a1ccad924a8e69527526ad7d5a114e569d3b493f182e50c69` |
| `output-special-doc-return.xsd` | https://pajak.go.id/sites/default/files/2024-11/Retur%20DOk%20Lain%20Keluaran_0.xlsx (`78319cb33a2c1151b032ad63eca82d47db531ac0568cc9d8ffcc5e539f8acfd6`) | the `OutputSpecialDocReturn` `xs:schema` embedded in `xl/xmlMaps.xml`, verbatim, with an XML declaration added | `031c4a5db6c219d2aa306b29df4e8c310280777855dbc3c3e6ae05de4802a45c` |

## Value rules taken from the same DJP files

These rules come from the files themselves, not from the XSD types:

- Retail workbook (`Retail_XML Induk…`, release note v1.2, 28 Oct 2025):
  - `TrxCode` is `Normal` for I.A.5, `07`/`08` for I.A.9 and `NoVAT` for I.B.
  - `BuyerIdOpt` is `NPWP` or `NIK`.
  - `GoodServiceOpt` is `A` (barang) or `B` (jasa).
  - The workbook formulas are `OtherTaxBaseSellingPrice = ROUND(11/12 × TaxBaseSellingPrice, 0)` and `VAT = ROUND(OtherTaxBaseSellingPrice × 12%, 0)`.
  - The workbook's `PENJUALAN HARI …` rows use the buyer ID `0000000000000000`.
- Retur workbook (`Retur DOk Lain Keluaran_0.xlsx`), sheets "Validation on xml" and the code lists:
  - `DocumentNumber` is the number of the document being returned. `ReturnDocumentNumber` is the return's own number.
  - `TransactionType` defaults to `01` (DELIVERY). `DocumentType` takes `1` (Normal) or `2` (Replacement).
  - `TransactionDetail` takes `01`–`10`. `TransactionDocument` takes `01`–`10` (`01` = documents equivalent to a tax invoice).
  - `DocumentDate` is `DD-MM-YYYY`. `BuyerTIN` must be `0000000000000000`.
  - `ReturnTaxBase` and `ReturnVAT` must not exceed the remaining balance of the document being returned.
- Faktur workbook (`Sample Faktur PK Template v.1.6.1.xlsx`, sheet `Keterangan`):
  - `TrxCode 04` means "DPP Nilai Lain".
  - `UM.0021` means Piece and `UM.0030` means Kegiatan.
  - Amounts may have at most 2 decimals and use commercial rounding.
  - `VAT` = rate × `OtherTaxBase` for codes 01, 04 and 09.

The XSD element types (`xs:byte` for `VAT` and the return amounts, `xs:int` for the retail base) are what Excel inferred from the small
sample values when the map was made. The amounts Coretax actually accepts are larger, as the samples themselves show (`319000`,
`2900000`). The tests therefore check element order and presence against the XSD, and check amounts as non-negative integers, not by
these inferred types.
