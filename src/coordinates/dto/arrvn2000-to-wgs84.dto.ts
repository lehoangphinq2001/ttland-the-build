import { ApiProperty } from "@nestjs/swagger";

export class ArrCreateCoordinateDto {
    @ApiProperty()
    readonly coordinates: [string, string][];

    @ApiProperty()
    readonly provinceId: string;
}
