import { ApiProperty } from "@nestjs/swagger";

export class CreateCoordinateDto {
    @ApiProperty()
    readonly x: string;

    @ApiProperty()
    readonly y: string;

    @ApiProperty()
    readonly provinceId: string;
}
