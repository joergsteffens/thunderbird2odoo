import { test } from "node:test";
import assert from "node:assert/strict";
import { rewriteDeliveredTo } from "../lib/odooMailUpload.js";

const BODY = "\r\n\r\nDelivered-To: body@example.com\r\n";

test("rewriteDeliveredTo replaces Delivered-To with X-Original-To", () => {
  const raw =
    "Return-Path: <deborah@example.com>\r\n" +
    "X-Original-To: riccardo@example.com\r\n" +
    "Delivered-To: rickn@internal.example.com\r\n" +
    "From: deborah@example.com\r\n" +
    "To: riccardo@example.com" +
    BODY;
  assert.equal(
    rewriteDeliveredTo(raw),
    "Return-Path: <deborah@example.com>\r\n" +
      "X-Original-To: riccardo@example.com\r\n" +
      "Delivered-To: riccardo@example.com\r\n" +
      "From: deborah@example.com\r\n" +
      "To: riccardo@example.com" +
      BODY,
  );
});

test("rewriteDeliveredTo removes Delivered-To without X-Original-To", () => {
  const raw =
    "Delivered-To: rickn@internal.example.com\r\n" +
    "From: a@example.com\r\n" +
    "To: b@example.com" +
    BODY;
  assert.equal(
    rewriteDeliveredTo(raw),
    "From: a@example.com\r\nTo: b@example.com" + BODY,
  );
});

test("rewriteDeliveredTo drops multiple and folded Delivered-To headers", () => {
  const raw =
    "X-Original-To: b@example.com\n" +
    "Delivered-To: one@internal.example.com\n" +
    "Delivered-To:\n two@internal.example.com\n" +
    "Subject: hi\n\nbody\n";
  assert.equal(
    rewriteDeliveredTo(raw),
    "X-Original-To: b@example.com\n" +
      "Delivered-To: b@example.com\n" +
      "Subject: hi\n\nbody\n",
  );
});

test("rewriteDeliveredTo leaves messages without Delivered-To unchanged", () => {
  const raw = "X-Original-To: b@example.com\r\nSubject: hi" + BODY;
  assert.equal(rewriteDeliveredTo(raw), raw);
});

test("rewriteDeliveredTo never touches the body", () => {
  const raw = "Subject: hi" + BODY;
  assert.equal(rewriteDeliveredTo(raw), raw);
});
