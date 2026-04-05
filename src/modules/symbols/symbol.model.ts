import mongoose, { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { symbolKinds, type JsonObject, type SymbolKind } from '../../shared/types/domain.js';

export interface SymbolRecord {
  repoId: Types.ObjectId;
  fileId: Types.ObjectId;
  name: string;
  kind: SymbolKind;
  fqName: string;
  exported: boolean;
  startLine: number;
  endLine: number;
  signature: string;
  parentSymbolId?: Types.ObjectId;
  metadata: JsonObject;
}

export type SymbolDocument = HydratedDocument<SymbolRecord>;

const symbolSchema = new Schema<SymbolRecord>(
  {
    repoId: {
      type: Schema.Types.ObjectId,
      ref: 'Repository',
      required: true,
      index: true
    },
    fileId: {
      type: Schema.Types.ObjectId,
      ref: 'FileDocument',
      required: true,
      index: true
    },
    name: {
      type: String,
      required: true
    },
    kind: {
      type: String,
      enum: symbolKinds,
      required: true
    },
    fqName: {
      type: String,
      required: true
    },
    exported: {
      type: Boolean,
      required: true,
      default: false
    },
    startLine: {
      type: Number,
      required: true
    },
    endLine: {
      type: Number,
      required: true
    },
    signature: {
      type: String,
      required: true
    },
    parentSymbolId: {
      type: Schema.Types.ObjectId,
      ref: 'SymbolDocument'
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {}
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

symbolSchema.index({ repoId: 1, fqName: 1 }, { unique: true });
symbolSchema.index({ repoId: 1, name: 1 });
symbolSchema.index({ repoId: 1, exported: -1, name: 1 });
symbolSchema.index({ fileId: 1, startLine: 1 });
symbolSchema.index({ parentSymbolId: 1 });

export const SymbolDocumentModel: Model<SymbolRecord> =
  (mongoose.models.SymbolDocument as Model<SymbolRecord> | undefined) ??
  model<SymbolRecord>('SymbolDocument', symbolSchema);
