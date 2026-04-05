import mongoose, { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { edgeTypes, type EdgeType, type JsonObject } from '../../shared/types/domain.js';

export interface EdgeRecord {
  repoId: Types.ObjectId;
  fromSymbolId: Types.ObjectId;
  toSymbolId: Types.ObjectId;
  type: EdgeType;
  metadata: JsonObject;
}

export type EdgeDocument = HydratedDocument<EdgeRecord>;

const edgeSchema = new Schema<EdgeRecord>(
  {
    repoId: {
      type: Schema.Types.ObjectId,
      ref: 'Repository',
      required: true,
      index: true
    },
    fromSymbolId: {
      type: Schema.Types.ObjectId,
      ref: 'SymbolDocument',
      required: true
    },
    toSymbolId: {
      type: Schema.Types.ObjectId,
      ref: 'SymbolDocument',
      required: true
    },
    type: {
      type: String,
      enum: edgeTypes,
      required: true
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

edgeSchema.index({ repoId: 1, fromSymbolId: 1, type: 1 });
edgeSchema.index({ repoId: 1, toSymbolId: 1, type: 1 });
edgeSchema.index({ repoId: 1, fromSymbolId: 1, toSymbolId: 1, type: 1 }, { unique: true });

export const EdgeDocumentModel: Model<EdgeRecord> =
  (mongoose.models.EdgeDocument as Model<EdgeRecord> | undefined) ??
  model<EdgeRecord>('EdgeDocument', edgeSchema);
