import { parseVarint } from "../parser-utils";
import {
  DatabaseBTreePage,
  DatabaseHeader,
  IndexLeafCell,
  IndexLeafPage,
} from "../type";

export function parseIndexLeafPage(
  page: DatabaseBTreePage,
  header: DatabaseHeader
): IndexLeafPage {
  const { data } = page;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  // (see https://www.sqlite.org/fileformat.html#b_tree_pages for more details)
  // > Let X be ((U-12)*64/255)-23. 
  // > Let M be ((U-12)*32/255)-23 and let K be M+((P-M)%(U-4)).

  // Calcualte max and min local size to determine overflow
  const usableSize = header.pageSize - header.reservedSpace;
  const maxLocal = Math.floor(((usableSize - 12) * 64) / 255 - 23);
  const minLocal = Math.floor(((usableSize - 12) * 32) / 255 - 23);

  const cells = page.cellPointerArray.map((cell): IndexLeafCell => {
    let cursor = cell.value;

    const [payloadSize, payloadSizeBytes] = parseVarint(view, cursor);
    let localPayloadSize = payloadSize;
    let overflow = false;
    cursor += payloadSizeBytes;
    
    // > If the payload size P is less than or equal to X then the entire payload is stored on the b-tree page.
    // Determine if it is overflow
    if (payloadSize > maxLocal) {
      // > If P is greater than X then the number of bytes stored on the index b-tree page is K if K is less than or equal to X or M otherwise.
      localPayloadSize =
        minLocal + ((payloadSize - minLocal) % (usableSize - 4));
      if (localPayloadSize > maxLocal) {
          localPayloadSize = minLocal;
      }
      overflow = true;
    }

    const payload = data.subarray(cursor, cursor + localPayloadSize);
    cursor += localPayloadSize;

    let overflowPageNumber: number | null = null;
    if (overflow) {
      overflowPageNumber = view.getUint32(cursor);
      cursor += 4;
    }

    return {
      payloadSize,
      payload,
      payloadSizeLength: payloadSizeBytes,
      overflowPageNumber,
      length: cursor - cell.value,
      offset: cell.value,
    };
  });

  cells.sort((a, b) => a.offset - b.offset);

  return {
    ...page,
    type: "Index Leaf",
    cells,
  };
}
