use arrow::{
    array::{ArrayRef, Int32Array, StringArray},
    datatypes::{DataType, Field, Schema},
    ipc::{reader::FileReader, writer::FileWriter},
    record_batch::RecordBatch,
};
use rand::prelude::SliceRandom;
use std::{fs::File, sync::Arc};

fn create_batch_int32(
    num_rows: usize,
) -> Result<(Schema, RecordBatch), Box<dyn std::error::Error>> {
    let schema = Schema::new(vec![Field::new("0", DataType::Int32, false)]);
    let mut values: Vec<i32> = (0..num_rows)
        .into_iter()
        .enumerate()
        .map(|(index, _)| index as i32)
        .collect();

    let mut rng = rand::thread_rng();
    values.shuffle(&mut rng);

    let array = Int32Array::from(values);

    Ok((
        schema.clone(),
        RecordBatch::try_new(Arc::new(schema), vec![Arc::new(array) as ArrayRef])?,
    ))
}

fn create_batch_utf8(num_rows: usize) -> Result<(Schema, RecordBatch), Box<dyn std::error::Error>> {
    let schema = Schema::new(vec![Field::new("0", DataType::Utf8, false)]);
    let mut values: Vec<String> = (0..num_rows)
        .into_iter()
        .enumerate()
        .map(|(index, _)| format!("#{:0>10}", index))
        .collect();

    let mut rng = rand::thread_rng();
    values.shuffle(&mut rng);

    let array = StringArray::from(values);

    Ok((
        schema.clone(),
        RecordBatch::try_new(Arc::new(schema), vec![Arc::new(array) as ArrayRef])?,
    ))
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let target_dir = "../data";

    for num_rows in [1024, 4096, 16384, 65536, 262144, 1048576] {
        {
            let file_name = format!("{}/int32.{}.arrow", target_dir, num_rows);

            {
                let file = File::create(file_name.clone()).unwrap();
                let (schema, batch) = create_batch_int32(num_rows)?;
                let mut writer = FileWriter::try_new(file, &schema).unwrap();
                writer.write(&batch).unwrap();
                writer.finish().unwrap();
            }

            {
                let file = File::open(file_name.clone()).unwrap();
                let mut reader = FileReader::try_new(file).unwrap();
                while let Some(Ok(batch)) = reader.next() {
                    println!(
                        "file: {}, num rows: {}",
                        file_name.clone(),
                        batch.num_rows()
                    );
                }
            }
        }

        {
            let file_name = format!("{}/utf8.{}.arrow", target_dir, num_rows);

            {
                let file = File::create(file_name.clone()).unwrap();
                let (schema, batch) = create_batch_utf8(num_rows)?;
                let mut writer = FileWriter::try_new(file, &schema).unwrap();

                writer.write(&batch).unwrap();
                writer.finish().unwrap();
            }

            {
                let file = File::open(file_name.clone()).unwrap();
                let mut reader = FileReader::try_new(file).unwrap();
                while let Some(Ok(batch)) = reader.next() {
                    println!(
                        "file: {}, num rows: {}",
                        file_name.clone(),
                        batch.num_rows()
                    );
                }
            }
        }
    }

    Ok(())
}
