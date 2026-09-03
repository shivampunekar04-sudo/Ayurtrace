/**
 * Request DTOs with edge validation (execution plan §6.1). These implement the
 * frozen contract request interfaces and add runtime guards so malformed input
 * is rejected at the gateway boundary before it ever reaches chaincode.
 */
import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString,
  Min, ValidateNested,
} from 'class-validator';
import type {
  CollectionRequest, AggregationRequest, TransformationRequest,
  QualityTestRequest, FormulationRequest,
} from '@ayurtrace/contracts';

class LocationDto {
  @IsNumber() lat!: number;
  @IsNumber() lon!: number;
  @IsNumber() altitudeM!: number;
}

const ENTRY = ['TIER1_PWA', 'TIER2_OFFLINE', 'TIER3_SMS', 'TIER4_CFA'] as const;

export class CollectionDto implements CollectionRequest {
  @IsString() speciesCode!: string;
  @IsNumber() @Min(0.001) quantityKg!: number;
  @IsString() plantPart!: string;
  @IsString() collectorId!: string;
  @IsString() season!: string;
  @ValidateNested() @Type(() => LocationDto) location!: LocationDto;
  @IsIn(ENTRY) entryMethod!: CollectionRequest['entryMethod'];
  @IsOptional() @IsString() photoIpfsCID?: string;
  @IsOptional() @IsBoolean() offlineSoftReserve?: boolean;
}

export class AggregationDto implements AggregationRequest {
  @IsString() parentEpc!: string;
  @IsArray() @ArrayMinSize(1) @IsString({ each: true }) childEpcs!: string[];
  @IsNumber() @Min(0) declaredKg!: number;
  @IsNumber() @Min(0) measuredKg!: number;
  @IsString() zoneId!: string;
}

class TransformInputDto {
  @IsString() epc!: string;
  @IsNumber() @Min(0) quantityKg!: number;
}
export class TransformationDto implements TransformationRequest {
  @IsIn(['PROCESS', 'MERGE', 'FORMULATION']) kind!: TransformationRequest['kind'];
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => TransformInputDto)
  inputs!: TransformInputDto[];
  @IsNumber() @Min(0) outputKg!: number;
  @IsNumber() @Min(0) declaredLossFactor!: number;
  @IsString() zoneId!: string;
  @IsOptional() @IsNumber() dryingGapSeconds?: number;
}

type MetricName = 'moisture' | 'lead' | 'arsenic' | 'mercury' | 'cadmium' | 'pesticide';
class MetricDto {
  @IsIn(['moisture', 'lead', 'arsenic', 'mercury', 'cadmium', 'pesticide']) name!: MetricName;
  @IsNumber() value!: number;
  @IsString() unit!: string;
  @IsNumber() limit!: number;
  @IsBoolean() withinLimit!: boolean;
}
class DnaDto {
  @IsString() declaredSpecies!: string;
  @IsString() confirmedSpecies!: string;
}
export class QualityTestDto implements QualityTestRequest {
  @IsString() epc!: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => MetricDto) metrics!: MetricDto[];
  @IsOptional() @ValidateNested() @Type(() => DnaDto) dna?: DnaDto;
  @IsString() ipfsCID!: string;
  @IsString() testingLabMsp!: string;
  @IsString() verifierMsp!: string;
  @IsIn(['REGULATOR', 'SECOND_LAB']) verifierRole!: QualityTestRequest['verifierRole'];
}

export class FormulationDto implements FormulationRequest {
  @IsArray() @ArrayMinSize(1) @IsString({ each: true }) inputEpcs!: string[];
  @IsString() productName!: string;
  @IsNumber() @Min(1) unitCount!: number;
  @IsString() manufacturerMsp!: string;
}
