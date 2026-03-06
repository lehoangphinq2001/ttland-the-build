/* eslint-disable prettier/prettier */
/* eslint-disable no-var */
/* eslint-disable @typescript-eslint/ban-types */
import * as bcrypt from 'bcrypt';
import * as otplib from 'otplib';
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import * as moment from 'moment';
import { unlink, rename } from 'node:fs/promises';
import { extname, dirname } from 'path';
import { diskStorage } from 'multer';
import { existsSync, mkdirSync } from 'fs';
import * as imExec from 'child_process';
import * as CryptoJS from 'crypto-js';
import * as md5 from 'md5.js';
import { SAVE_FILE } from './common.constant';
import { parse } from '@terraformer/wkt';;
const exec = imExec.exec

@Injectable()
export class CommonService {
  private secretKey = "E5nH6BWRluITGlXIt57W"
  // const KEY_CONNECT = "TTLAND-fGXGrUkY$A%q4EQa@GdS5e2UI3xmTJ4Na22"

  isInteger(text: string): boolean {
    const num = parseFloat(text); // Chuyển chuỗi thành số
    return Number.isInteger(num); // Kiểm tra số nguyên
  }

  parseFileDCName(fileName: string): { name_string: string; name_number: string | null } {
    const regex = /^(D|DC)(\d+)/;
    const match = fileName.match(regex);
    if (match) {
      return {
        name_string: fileName,        // Giữ nguyên chuỗi ban đầu
        name_number: match[2],       // Số ngay sau D hoặc DC
      };
    }
    return {
      name_string: fileName?.toLocaleUpperCase(),
      name_number: null,
    };
  }

  extractPOINTCoordinates(pointString: string): { lng: number; lat: number } | null {
    // Biểu thức chính quy để lấy tọa độ từ chuỗi POINT(longitude latitude)
    const pointRegex = /POINT\((-?\d+\.\d+)\s(-?\d+\.\d+)\)/;
    const match = pointString.match(pointRegex);

    if (match) {
      const longitude = parseFloat(match[1]);
      const latitude = parseFloat(match[2]);
      return { lng: longitude, lat: latitude };
    }
    return null; // Trả về null nếu không tìm thấy tọa độ hợp lệ
  }

  hashText(text: string): string {
    return bcrypt.hashSync(text, 10);
  }

  compareHash(text: string, hash: string) {
    return bcrypt.compareSync(text, hash);
  }

  _checkArray(array: any, message_true = null, message_false = null) {
    if (message_true || message_false) {
      if (array.length !== 0) {
        return {
          success: true,
          data: array,
          message: message_true
        };
      } else {
        return {
          success: false,
          message: message_false,
          data: [],
        };
      }
    } else {
      if (array.length !== 0) {
        return {
          success: true,
          data: array,
        };
      } else {
        return {
          success: false,
          data: [],
        };
      }
    }
  }

  _checkObject(object: {}, message_true = null, message_false = null) {
    if (message_true || message_false) {
      if (object) {
        return {
          success: true,
          data: object,
          message: message_true
        };
      } else {
        return {
          success: false,
          message: message_false,
          data: [],
        };
      }
    } else {
      if (object) {
        return {
          success: true,
          data: object,
        };
      } else {
        return {
          success: false,
          data: [],
        };
      }
    }
  }

  _checkUpdate(object: {}, message_true = null, message_false = null) {
    var obj: any = object;
    if (message_true || message_false) {
      if (obj?.affected == 1) {
        return {
          success: true,
          data: obj,
          message: message_true
        };
      } else {
        return {
          success: false,
          message: message_false,
          data: [],
        };
      }
    } else {
      if (obj?.affected == 1) {
        return {
          success: true,
          data: obj,
        };
      } else {
        return {
          success: false,
          data: [],
        };
      }
    }
  }

  _checkDelete(object: {}, message_true = null, message_false = null) {
    var obj: any = object;
    if (message_true || message_false) {
      if (obj?.affected == 1) {
        return {
          success: true,
          data: obj,
          message: message_true
        };
      } else {
        return {
          success: false,
          message: message_false,
          data: [],
        };
      }
    } else {
      if (obj?.affected == 1) {
        return {
          success: true,
          data: obj,
        };
      } else {
        return {
          success: false,
          data: [],
        };
      }
    }
  }

  removeDuplicates(arr) {
    var obj = {};
    var ret_arr = [];
    for (let i = 0; i < arr.length; i++) {
      obj[arr[i]] = true;
    }
    for (const key in obj) {
      ret_arr.push(key);
    }
    return ret_arr;
  }

  // Hàm nhóm các mục theo level
  groupBy(array, key) {
    return array.reduce((result, currentValue) => {
      const group = currentValue[key];
      (result[group] = result[group] || []).push(currentValue);
      return result;
    }, {});
  }

  // KIỂM TRA PHÂN tử trong mảng có chung level hay không
  checkSameLevel(data: any): boolean {
    if (data.length === 0) return false; // Nếu mảng rỗng, trả về false

    // Lấy `level` của phần tử đầu tiên để so sánh
    const firstLevel = data[0].level;

    // Kiểm tra tất cả các phần tử có cùng `level` hay không
    return data.every(item => item.level === firstLevel);
  }

  // KIỂM TRA mảng có dủ các level 4-13
  hasRequiredLevels(data: any): boolean {
    const requiredLevels = new Set([4, 13]);

    // Lấy tất cả các level trong mảng và chuyển thành Set để loại bỏ trùng lặp
    const levelsInData = new Set(data.map(item => item.level));

    // Kiểm tra xem `levelsInData` có chứa tất cả phần tử trong `requiredLevels`
    return [...requiredLevels].every(level => levelsInData.has(level));
  }

  // KIỂM TRA mảng có dủ các color index 1-3; Số thửa - Diện tích
  hasRequiredColorIndex(data: any): boolean {
    const requiredColorIndex = new Set([1, 3]);

    // Lấy tất cả các level trong mảng và chuyển thành Set để loại bỏ trùng lặp
    const levelsInData = new Set(data.map(item => item.level));

    // Kiểm tra xem `levelsInData` có chứa tất cả phần tử trong `requiredLevels`
    return [...requiredColorIndex].every(level => levelsInData.has(level));
  }

  hasRequiredColors(data: any, arrColor: any): boolean {
    const requiredColors = new Set(arrColor);// Vàng, xanh lá, xanh dương
    // Lấy tất cả các mã màu trong mảng và chuyển thành Set để loại bỏ trùng lặp
    const colorsInData = new Set(data.map(item => item.color));
    // Kiểm tra xem colorsInData có chứa tất cả phần tử trong requiredColors
    return [...requiredColors].every(color => colorsInData.has(color));
  }


  replaceAll(str, find, replace) {
    return str.replace(new RegExp(find, 'g'), replace);
  };

  isArray(obj) {
    return obj !== undefined && obj !== null && obj.constructor === Array;
  };

  isEmpty(obj) {
    if (obj === 'null' || obj === '' || obj === '' || obj === null || obj === 'undefined' || obj === undefined) {
      return true;
    }
    for (const prop in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, prop)) {
        return false;
      }
    }
    return JSON.stringify(obj) === JSON.stringify({});
  };

  isNull(obj) {
    if (obj === "null" || obj === "" || obj === '' || obj === null || obj === "undefined" || obj === undefined) {
      return true;
    } else {
      return false;
    }
  };

  isNumber(n) {
    return !isNaN(parseFloat(n)) && !isNaN(n - 0)
  };

  isNumberFLoat(n) {
    // Kiểm tra nếu n là chuỗi hợp lệ và không rỗng
    if (typeof n !== 'string' || n.trim() === '') return false;

    if (n.includes('.') || n.includes(',')) {
      return true;
    } else {
      return false;
    }
  };

  isNormalInteger(str) {
    var n = Math.floor(Number(str));
    return n !== Infinity && String(n) === str && n >= 0;
  };

  isUpperCase(str) {
    return str === str.toUpperCase();
  };

  extractStringMADAT_SOTO_DT(input) {
    const textMatch = input.match(/^[A-Z+\s]+/); // Lấy phần chữ cái và dấu "+"
    const numberMatch = input.match(/\b\d+(?=\/)/); // Lấy số trước dấu "/"

    const text = textMatch ? textMatch[0].trim() : null; // Xóa khoảng trắng dư thừa
    const number = numberMatch ? parseInt(numberMatch[0], 10) : null;

    return { text, number }; // Trả về object chứa text và number
  }

  sortObject(o) {
    var sorted = {},
      key, a = [];

    for (key in o) {
      if (o.hasOwnProperty(key)) {
        a.push(key);
      }
    }

    a.sort();

    for (key = 0; key < a.length; key++) {
      sorted[a[key]] = o[a[key]];
    }
    return sorted;
  };

  formatError(error) {
    return [
      { messages: [{ id: error.id, message: error.message, field: error.field }] },
    ]
  };

  getShortMd5(key) {
    return new md5().update(key).digest('hex').substring(0, 6)
  };

  removeVietnameseTones(str) {
    str = str.replace(/à|á|ạ|ả|ã|â|ầ|ấ|ậ|ẩ|ẫ|ă|ằ|ắ|ặ|ẳ|ẵ/g, "a");
    str = str.replace(/è|é|ẹ|ẻ|ẽ|ê|ề|ế|ệ|ể|ễ/g, "e");
    str = str.replace(/ì|í|ị|ỉ|ĩ/g, "i");
    str = str.replace(/ò|ó|ọ|ỏ|õ|ô|ồ|ố|ộ|ổ|ỗ|ơ|ờ|ớ|ợ|ở|ỡ/g, "o");
    str = str.replace(/ù|ú|ụ|ủ|ũ|ư|ừ|ứ|ự|ử|ữ/g, "u");
    str = str.replace(/ỳ|ý|ỵ|ỷ|ỹ/g, "y");
    str = str.replace(/đ/g, "d");
    str = str.replace(/À|Á|Ạ|Ả|Ã|Â|Ầ|Ấ|Ậ|Ẩ|Ẫ|Ă|Ằ|Ắ|Ặ|Ẳ|Ẵ/g, "A");
    str = str.replace(/È|É|Ẹ|Ẻ|Ẽ|Ê|Ề|Ế|Ệ|Ể|Ễ/g, "E");
    str = str.replace(/Ì|Í|Ị|Ỉ|Ĩ/g, "I");
    str = str.replace(/Ò|Ó|Ọ|Ỏ|Õ|Ô|Ồ|Ố|Ộ|Ổ|Ỗ|Ơ|Ờ|Ớ|Ợ|Ở|Ỡ/g, "O");
    str = str.replace(/Ù|Ú|Ụ|Ủ|Ũ|Ư|Ừ|Ứ|Ự|Ử|Ữ/g, "U");
    str = str.replace(/Ỳ|Ý|Ỵ|Ỷ|Ỹ/g, "Y");
    str = str.replace(/Đ/g, "D");
    // Some system encode vietnamese combining accent as individual utf-8 characters
    // Một vài bộ encode coi các dấu mũ, dấu chữ như một kí tự riêng biệt nên thêm hai dòng này
    str = str.replace(/\u0300|\u0301|\u0303|\u0309|\u0323/g, ""); // ̀ ́ ̃ ̉ ̣  huyền, sắc, ngã, hỏi, nặng
    str = str.replace(/\u02C6|\u0306|\u031B/g, ""); // ˆ ̆ ̛  Â, Ê, Ă, Ơ, Ư
    // Remove extra spaces
    // Bỏ các khoảng trắng liền nhau
    str = str.replace(/ + /g, " ");
    str = str.trim();
    // Remove punctuations
    // Bỏ dấu câu, kí tự đặc biệt
    str = str.replace(/!|@|%|\^|\*|\(|\)|\+|\=|\<|\>|\?|\/|,|\.|\:|\;|\'|\"|\&|\#|\[|\]|~|\$|_|`|-|{|}|\||\\/g, " ");
    return str;
  };

  getUUID(prefix = null) {
    let text = "";
    const possible = "abcdefghijklmnopqrstuvwxyz0123456789";

    for (let i = 0; i < 5; i++)
      text += possible.charAt(Math.floor(Math.random() * possible.length));

    if (prefix) {
      return (`${prefix}-${new Date().valueOf()}-${text}`).toLowerCase();
    }
    return (`${new Date().valueOf()}-${text}`).toLowerCase();
  };

  printLog(param1, param2) {
    if (param2 === null || param2 === undefined) {
      console.log(moment().format("YYYY-MM-DD HH:mm:ss") + " >>> ", param1)
    } else {
      console.log(moment().format("YYYY-MM-DD HH:mm:ss") + " >>> ", param1, param2)
    }
  };

  sleep(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  };

  async deleteFileDgnData(namefile: string) {
    try {
      var path = `E://DATA_DGN_UPLOAD_TTLAND2526//${namefile}`;
      await unlink(path);
      return {
        success: true
      }
    } catch (error) {
      return {
        success: false
      }
    }
  }

    async deleteFileDC(path: string) {
    try {
      await unlink(path);
      return {
        success: true
      }
    } catch (error) {
      return {
        success: false
      }
    }
  }

    async moveFileDC(srcPath: string, destPath: string) {
      try {
        const destDir = dirname(destPath);
        if (!existsSync(destDir)) {
          mkdirSync(destDir, { recursive: true });
        }
        await rename(srcPath, destPath);
        return { success: true };
      } catch (error) {
        return { success: false, message: error?.message || String(error) };
      }
    }

  // count: number = 0
  async decryptData(input: string) {
    var transit_message = "45f9f909405a450975f0c5b140a2f2ec00000000000000000000000000000000U2FsdGVkX1/BenSxhcc7z9l1nwVzMyPCqekmDB8iyhQ="

    var iv = await CryptoJS.enc.Hex.parse('00000000000000000000000000000000');
    var encrypted = await transit_message.substring(64);

    var decrypted = await CryptoJS.AES.decrypt(encrypted, this.secretKey, {
      iv: iv,
      padding: CryptoJS.pad.Pkcs7,
      mode: CryptoJS.mode.CBC,
      hasher: CryptoJS.algo.SHA256
    });

    return decrypted.toString(CryptoJS.enc.Utf8);;
  }

  async extractNumbers(input) {
    // Sử dụng regex để loại bỏ ký tự không phải số
    const cleaned = await input.replace(/[^\d]/g, '');
    return cleaned ? Number(cleaned) : null; // Trả về số hoặc null nếu không có số
  }

  compareInputWithNumber(input, compareValue) {
    const match = input.match(/\s(\d+)\//);
    if (match) {
      // So sánh giá trị trích xuất được với compareValue
      return match[1] === compareValue;
    }
    return false;
  }

  // En code ===> true 
  encryptData(data: any): any {
    var salt = CryptoJS.lib.WordArray.random(128 / 8);
    var iv = CryptoJS.enc.Hex.parse('00000000000000000000000000000000');

    var encrypted = CryptoJS.AES.encrypt(JSON.stringify(data), this.secretKey, {
      iv: iv,
      padding: CryptoJS.pad.Pkcs7,
      mode: CryptoJS.mode.CBC,
      hasher: CryptoJS.algo.SHA256
    });

    // salt, iv will be hex 32 in length
    // append them to the ciphertext for use  in decryption
    var transit_message = salt.toString() + iv.toString() + encrypted.toString();
    return transit_message;
  }
}

function uuidRandom(file) {
  file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
  const result = `${Date.now()}$${file.originalname}`;
  return result;
}

// ******************SAVE FILE UPLOAD*************************
export const multerUploadFile = {
  fileFilter: (req, file, callback) => {
    if (file.originalname.match(/\.(dgn|DGN|zip|ZIP|MBTILES|mbtiles)$/)) {
      return callback(null, true);
    }
    // file upload can not support format
    callback(new HttpException(`Nonsupport file type ${extname(file.originalname)}`, HttpStatus.BAD_REQUEST), false);
  },

  storage: diskStorage({
    destination: (req: any, file: any, callback: any) => {
      const uploadPath = SAVE_FILE.DGN_FILE;
      if (!existsSync(uploadPath)) {
        mkdirSync(uploadPath)
      }
      callback(null, uploadPath)
    },
    filename: (req, file, callback) => {
      file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
      callback(null, uuidRandom(file))
    },
  }),
}

export const multerUploadFilePlanning = {
  fileFilter: (req, file, callback) => {
    if (file.originalname.match(/\.(geojson|GEOJSON|zip|ZIP)$/)) {
      return callback(null, true);
    }
    // file upload can not support format
    callback(new HttpException(`Nonsupport file type ${extname(file.originalname)}`, HttpStatus.BAD_REQUEST), false);
  },

  storage: diskStorage({
    destination: (req: any, file: any, callback: any) => {
      const uploadPath = SAVE_FILE.DGN_FILE;
      if (!existsSync(uploadPath)) {
        mkdirSync(uploadPath)
      }
      callback(null, uploadPath)
    },
    filename: (req, file, callback) => {
      file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
      callback(null, uuidRandom(file))
    },
  }),
}


export const customer_multerUploadFile = {
  fileFilter: (req, file, callback) => {
    if (file.originalname.match(/\.(dgn|DGN|zip|ZIP|MBTILES|mbtiles|pdf|PDF)$/)) {
      return callback(null, true);
    }
    // file upload can not support format
    callback(new HttpException(`Nonsupport file type ${extname(file.originalname)}`, HttpStatus.BAD_REQUEST), false);
  },

  storage: diskStorage({
    destination: (req: any, file: any, callback: any) => {
      const uploadPath = SAVE_FILE.DGN_FILE;
      if (!existsSync(uploadPath)) {
        mkdirSync(uploadPath)
      }
      callback(null, uploadPath)
    },
    filename: (req, file, callback) => {
      file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
      callback(null, uuidRandom(file))
    },
  }),
}